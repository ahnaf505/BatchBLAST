import asyncio
import json
import secrets
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set

from fastapi import FastAPI, WebSocket, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse, StreamingResponse
from starlette.websockets import WebSocketDisconnect
from pydantic import BaseModel, Field
import uvicorn
from io import BytesIO
from pathlib import Path
from CONFIG import load_config, save_config
from blast import run_blast_job


class ConfigPayload(BaseModel):
    database: str = Field(..., min_length=1)
    program: str = Field(..., min_length=1)
    filterSelect: str = Field(..., min_length=1)
    outputQty: int = Field(..., gt=0)
    nonAnomaly: str = Field(..., min_length=1)
    speciesName: str = Field(..., min_length=1)

app = FastAPI()

RESULTS_DIR = (Path.cwd() / "blast_res").resolve()
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")


JOB_RETENTION_SECONDS = 60 * 60  # keep finished job logs for 1 hour
job_states: Dict[str, Dict[str, Any]] = {}
job_subscribers: Dict[str, Set[WebSocket]] = defaultdict(set)
connection_jobs: Dict[WebSocket, Set[str]] = defaultdict(set)
job_lock = asyncio.Lock()


def _now() -> datetime:
    return datetime.utcnow()


def _parse_ws_payload(message: str) -> Dict[str, Any]:
    try:
        data = json.loads(message)
    except json.JSONDecodeError:
        return {"action": "start", "fasta": message}
    return data


async def _cleanup_expired_jobs() -> None:
    cutoff = _now() - timedelta(seconds=JOB_RETENTION_SECONDS)
    async with job_lock:
        expired_ids = [
            job_id
            for job_id, state in job_states.items()
            if state.get("status") in {"completed", "error"}
            and state.get("last_update", _now()) < cutoff
        ]
        for job_id in expired_ids:
            job_states.pop(job_id, None)
            job_subscribers.pop(job_id, None)


async def _create_job(job_id: str) -> None:
    async with job_lock:
        job_states[job_id] = {
            "job_id": job_id,
            "messages": [],
            "folder_id": None,
            "status": "running",
            "created_at": _now(),
            "last_update": _now(),
        }


async def _broadcast(subscribers: List[WebSocket], message: Dict[str, Any]) -> None:
    serialized = json.dumps(message)
    for ws in list(subscribers):
        try:
            await ws.send_text(serialized)
        except Exception:
            await unregister_connection(ws)
            continue


async def _send_ws_error(websocket: WebSocket, detail: str, job_id: Optional[str] = None) -> None:
    payload = {
        "type": "error",
        "jobId": job_id,
        "payload": [detail],
        "timestamp": _now().isoformat(),
    }
    try:
        await websocket.send_text(json.dumps(payload))
    except Exception:
        await unregister_connection(websocket)


async def unsubscribe_connection(
    websocket: WebSocket, job_id: Optional[str] = None
) -> None:
    async with job_lock:
        if job_id is None:
            tracked_jobs = connection_jobs.pop(websocket, set())
            for tracked in tracked_jobs:
                subscribers = job_subscribers.get(tracked)
                if subscribers and websocket in subscribers:
                    subscribers.remove(websocket)
            return

        if job_id in connection_jobs.get(websocket, set()):
            connection_jobs[websocket].discard(job_id)
        subscribers = job_subscribers.get(job_id)
        if subscribers and websocket in subscribers:
            subscribers.remove(websocket)


async def unregister_connection(websocket: WebSocket) -> None:
    """Remove a websocket from all subscriptions."""
    await unsubscribe_connection(websocket)


async def subscribe_connection(
    websocket: WebSocket, job_id: str, replay: bool = True
) -> None:
    async with job_lock:
        state = job_states.get(job_id)
        if not state:
            raise HTTPException(status_code=404, detail="Unknown job id")
        job_subscribers[job_id].add(websocket)
        connection_jobs[websocket].add(job_id)
        history = list(state["messages"])

    if replay:
        for message in history:
            try:
                await websocket.send_text(json.dumps(message))
            except Exception:
                await unregister_connection(websocket)
                break


async def publish_job_event(job_id: str, event_type: str, payload: Any) -> None:
    message = {
        "type": event_type,
        "jobId": job_id,
        "payload": payload,
        "timestamp": _now().isoformat(),
    }

    # Update job metadata for certain events.
    async with job_lock:
        state = job_states.get(job_id)
        subscribers = list(job_subscribers.get(job_id, set()))
        if state:
            if event_type == "folder" and isinstance(payload, dict):
                state["folder_id"] = payload.get("folderId")
            if event_type == "complete":
                state["status"] = "completed"
            if event_type == "error":
                state["status"] = "error"
            state["last_update"] = _now()
            # Keep history even if no subscribers for replay.
            state["messages"].append(message)

    await _broadcast(subscribers, message)

    if event_type in {"complete", "error"}:
        await _cleanup_expired_jobs()


def resolve_results_folder(folder_id: str) -> Path:
    raw_path = Path(folder_id)
    if not raw_path.is_absolute():
        resolved = (Path.cwd() / raw_path).resolve()
    else:
        resolved = raw_path.resolve()

    try:
        resolved.relative_to(RESULTS_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid folder path")

    return resolved

@app.get("/", response_class=HTMLResponse)
async def get_home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

def serialize_config():
    filter_value, output_qty, program, database, non_anomaly, species_name = load_config()
    try:
        output_qty_value = int(output_qty)
    except (TypeError, ValueError):
        output_qty_value = output_qty

    return {
        "filterSelect": filter_value,
        "outputQty": output_qty_value,
        "program": program,
        "database": database,
        "nonAnomaly": non_anomaly,
        "speciesName": species_name
    }


@app.get("/getconfig")
async def getconfig():
    return serialize_config()


@app.post("/saveconfig")
async def saveconfig(payload: ConfigPayload):
    save_config(
        payload.filterSelect,
        str(payload.outputQty),
        payload.program,
        payload.database,
        payload.nonAnomaly,
        payload.speciesName
    )
    return {"status": "success", "config": serialize_config()}

@app.get("/download")
async def download_endpoint(request: Request, type: int, folderid: str):
    folder_path = resolve_results_folder(folderid)
    folder_label = folder_path.name or folder_path.as_posix()

    if type == 1:
        csv_paths = sorted(folder_path.glob("*.csv"))
        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zipf:
            for file_path in csv_paths:
                if file_path.exists():
                    zipf.write(file_path, arcname=file_path.name)

        zip_buffer.seek(0)

        # Return as streaming ZIP response
        return StreamingResponse(
            zip_buffer,
            media_type="application/x-zip-compressed",
            headers={"Content-Disposition": f"attachment; filename={folder_label}_csv_bundle.zip"}
        )
        print("download req for CSV")
    elif type == 2:
        return FileResponse(
            str(folder_path / "BLAST_Full_Report.pdf"),
            media_type='application/pdf',
            filename=f'{folder_label}_full_report.pdf',
            headers={
                'Content-Disposition': f'attachment; filename="{folder_label}_full_report.pdf"'
            }
        )
    elif type == 3:
        return FileResponse(
            str(folder_path / "anomaly_output.pdf"),
            media_type='application/pdf',
            filename=f'{folder_label}_anomaly_report.pdf',
            headers={
                'Content-Disposition': f'attachment; filename="{folder_label}_anomaly_report.pdf"'
            }
        )
    elif type == 4:
        return FileResponse(
            str(folder_path / "inputs.fasta"),
            media_type='chemical/seq-na-fasta',
            filename=f'{folder_label}_inputs.fasta',
            headers={
                'Content-Disposition': f'attachment; filename="{folder_label}_inputs.fasta"'
            }
        )

@app.get("/preview")
async def download_endpoint(request: Request, type: int, folderid: str):
    folder_path = resolve_results_folder(folderid)
    folder_label = folder_path.name or folder_path.as_posix()
    if type == 2:
        return FileResponse(
            str(folder_path / "BLAST_Full_Report.pdf"),
            media_type='application/pdf',
            filename=f'{folder_label}_full_report.pdf',
            headers = {
                'Content-Disposition': f'inline; filename="{folder_label}_anomaly_report.pdf"',
                'Content-Type': 'application/pdf'
            }
        )
    elif type == 3:
        return FileResponse(
            str(folder_path / "anomaly_output.pdf"),
            media_type='application/pdf',
            filename=f'{folder_label}_anomaly_report.pdf',
            headers = {
                'Content-Disposition': f'inline; filename="{folder_label}_anomaly_report.pdf"',
                'Content-Type': 'application/pdf'
            }
        )



@app.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw_message = await websocket.receive_text()
            payload = _parse_ws_payload(raw_message)
            action = str(payload.get("action", "start")).lower()

            if action == "resume":
                job_id = payload.get("jobId")
                if not job_id:
                    await _send_ws_error(websocket, "Missing job id for resume")
                    continue
                try:
                    await subscribe_connection(websocket, job_id, replay=True)
                except HTTPException:
                    await _send_ws_error(websocket, "Unknown job id", job_id)
                    continue

                resume_ack = {
                    "type": "resume_ack",
                    "jobId": job_id,
                    "timestamp": _now().isoformat(),
                }
                await websocket.send_text(json.dumps(resume_ack))
                continue

            if action != "start":
                await _send_ws_error(websocket, f"Unknown action '{action}'")
                continue

            fasta_data = payload.get("fasta")
            if not fasta_data or not str(fasta_data).strip():
                await _send_ws_error(websocket, "Missing FASTA payload for job start")
                continue

            # ensure the connection only listens to the new job
            await unsubscribe_connection(websocket)

            requested_job = payload.get("jobId")
            job_id: Optional[str] = None
            while True:
                candidate = requested_job or secrets.token_hex(8)
                async with job_lock:
                    if candidate not in job_states:
                        job_id = candidate
                        break
                requested_job = None  # regenerate id if collision detected

            await _create_job(job_id)
            try:
                await subscribe_connection(websocket, job_id, replay=False)
            except HTTPException:
                await _send_ws_error(websocket, "Unable to subscribe to job", job_id)
                continue

            async def notifier(event_type: str, event_payload: Any) -> None:
                await publish_job_event(job_id, event_type, event_payload)

            await publish_job_event(
                job_id, "job_started", {"message": "BLAST job accepted"}
            )
            asyncio.create_task(run_blast_job(fasta_data, notifier))

            ack_payload = {
                "type": "job_ack",
                "jobId": job_id,
                "timestamp": _now().isoformat(),
            }
            await websocket.send_text(json.dumps(ack_payload))
    except WebSocketDisconnect:
        pass
    finally:
        await unregister_connection(websocket)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


#jsonobj = search("Etheostoma olmstedi isolate EolmZR cytochrome b (cytb) gene,")
#pprint.pprint(jsonobj)
