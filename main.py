import asyncio
import zipfile
#from search import search

from fastapi import FastAPI, WebSocket, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse, StreamingResponse
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

# Use current directory for templates
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")


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
    while True:
        try:
            data = await websocket.receive_text()
            asyncio.create_task(run_blast_job(data, websocket))

        except Exception as e:
            await websocket.close()
            break


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


#jsonobj = search("Etheostoma olmstedi isolate EolmZR cytochrome b (cytb) gene,")
#pprint.pprint(jsonobj)
