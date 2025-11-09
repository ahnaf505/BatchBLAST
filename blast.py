import requests
import string
import random
import re
import httpx
import time
import json
import io
import csv
import zipfile
import asyncio
from pathlib import Path

from CONFIG import *
from report import *

async def send_blast(fasta_string):
    folder_name = ''.join(random.choices(string.ascii_letters + string.digits, k=10))
    folder_path = Path("blast_res") / folder_name
    folder_path.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient() as client:
        headers = {
            "User-Agent": "Mozilla/5.0"
        }
        
        put_params = {
            "CMD": "Put",
            "PROGRAM": load_config()[2],
            "DATABASE": load_config()[3],
            "QUERY": fasta_string,
            "FORMAT_TYPE": "JSON2",
            "HITLIST_SIZE": load_config()[1],
            "DESCRIPTIONS": load_config()[1],
            "ALIGNMENTS": load_config()[1],
            "FILTER": load_config()[0]
        }
        
        for i in range(10):
            resp = await client.post(BASE_URL, data=put_params, headers=headers)
            if resp.status_code == 200:
                break
        rid_match = re.search(r'name="RID"\s+[^>]*value="([A-Z0-9]+)"', resp.text)
        rid = rid_match.group(1)
        return rid, folder_path

async def check_blast(rid):
    async with httpx.AsyncClient() as client:
        poll = await client.get(
            "https://blast.ncbi.nlm.nih.gov/Blast.cgi",
            params={"CMD": "Get", "RID": rid, "FORMAT_TYPE": "JSON2"},
        )
        text = poll.text
        if "Status=WAITING" in text:
            return 0, None
        if "Status=FAILED" in text:
            with open("error.log", 'w+') as f:
                f.write(text)
            return 9, None
        if "An error has occurred on the server" in text:
            with open("error.log", 'w+') as f:
                f.write(text)
            return 9, None
        if "Status=UNKNOWN" in text:
            with open("error.log", 'w+') as f:
                f.write(text)
            return 9, None
        else:  # Add this check
            return 1, poll.content

def parse_blast(content, folderid):
    folder_path = Path(folderid)
    folder_path.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        for name in zf.namelist():
            if not name.lower().endswith(".json"):
                continue
    
            with zf.open(name) as f:
                j = json.load(f)

            if "BlastJSON" in j:
                continue

            try:
                report = j["BlastOutput2"]["report"]
                search = report["results"]["search"]
                query_title = search.get("query_title", "")
                
                # Create a safe filename from query_title
                if query_title:
                    # Remove or replace characters that are not safe for filenames
                    safe_filename = re.sub(r'[<>:"/\\|?*]', '_', query_title)
                    # Limit filename length to avoid filesystem issues
                    safe_filename = safe_filename[:100]
                else:
                    # Fallback to original name if query_title is empty
                    safe_filename = name.replace(".json", "")
            except (KeyError, TypeError):
                continue
    
            rows = []
            for hit in search.get("hits", []):
                if not hit.get("description") or not hit.get("hsps"):
                    continue
                desc = hit["description"][0]
                hsps = hit["hsps"][0]
                rows.append({
                    "query_id": search.get("query_id", ""),
                    "query_title": search.get("query_title", ""),
                    "subject_id": desc.get("id", ""),
                    "subject_accession": desc.get("accession", ""),
                    "subject_title": desc.get("title", ""),
                    "taxid": desc.get("taxid", ""),
                    "sci_name": desc.get("sciname", ""),
                    "identity_pct": round(100 * hsps.get("identity", 0) / max(hsps.get("align_len", 1), 1), 2),
                    "bit_score": hsps.get("bit_score", ""),
                    "evalue": hsps.get("evalue", "")
                })
    
            csv_path = folder_path / f"{safe_filename}.csv"
            with csv_path.open("w", newline="", encoding="utf-8") as csvfile:
                fieldnames = [
                    "query_id", "query_title", "subject_id", "subject_accession",
                    "subject_title", "taxid", "sci_name", "identity_pct",
                    "bit_score", "evalue"
                ]
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                writer.writeheader()
                if rows:
                    writer.writerows(rows)

def write_fasta(fasta_string, folder_path):
    folder = Path(folder_path)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "inputs.fasta").write_text(fasta_string)

async def run_blast_job(data, notifier):
    content_ = ""
    try:
        await notifier(
            "progress",
            ["Running BLAST NCBI...", "Server is running mass BLAST operation."],
        )
        rid, folder_path = await send_blast(data)
        write_fasta(data, folder_path)
        folder_display = folder_path.as_posix()
        await notifier("folder", {"folderId": folder_display})
        await notifier(
            "progress",
            [
                "Waiting for BLAST Result...",
                f"BLAST NCBI Request ID: {rid}",
                f"BatchBLAST ID: {folder_display}",
                " This may take up 5 minutes",
            ],
        )

        while True:
            code, content = await check_blast(rid)
            if code == 0:
                await asyncio.sleep(4)
                continue
            elif code == 9:
                await notifier(
                    "error", ["Error", "An error occurred, please check error.log file."]
                )
                return
            elif code == 1:
                content_ = content
                break

        await notifier("progress", ["BLAST Completed...", "Processing result."])
        parse_blast(content_, folder_path)
        await notifier(
            "progress",
            ["Parsing Completed...", "BLAST Result successfully parsed, making reports."],
        )
        generate_report(folder_path)
        generate_blast_full_report(folder_path)
        await notifier(
            "complete",
            [
                "Successfully completed mass BLAST",
                "Mass BLAST is completed successfully and you can download the reports.",
            ],
        )
    except Exception as e:
        with open("error.log", 'w+') as f:
                f.write(str(e))
                f.write(str(content_))
        await notifier(
            "error", ["Error", "An error occurred, please check error.log file."]
        )


# ---- FIXES BELOW ----

# use poll.content instead of text for binary data
#data_bytes = poll.content
#
## --- 2. Extract JSONs ---
