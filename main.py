#from search import search

from fastapi import FastAPI, WebSocket, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse, StreamingResponse
import uvicorn
from io import BytesIO
from pathlib import Path
from blast import *
from CONFIG import load_config, load_config_dict, save_config

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

@app.get("/getconfig")
async def getconfig(request: Request):
    """Legacy endpoint returning the raw list for existing clients."""
    return JSONResponse(list(load_config()))


@app.get("/config")
async def read_config():
    """Return the current configuration as a JSON object."""
    return load_config_dict()


@app.post("/config")
async def update_config(config: dict):
    """Persist configuration updates coming from the UI."""
    required_fields = ["database", "program", "outputQty", "filterSelect", "nonAnomaly", "speciesName"]
    missing = [field for field in required_fields if not str(config.get(field, "")).strip()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing config fields: {', '.join(missing)}")

    save_config({
        "database": config["database"],
        "program": config["program"],
        "output_qty": config["outputQty"],
        "filter": config["filterSelect"],
        "non_anomaly": config["nonAnomaly"],
        "species_name": config["speciesName"],
    })
    return {"status": "ok", "config": load_config_dict()}

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
