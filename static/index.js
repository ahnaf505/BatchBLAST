const host = window.location.host;
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
let ws;
let reconnectAttempts = 0;
let reconnectTimer;
const wsStatusChip = document.getElementById('wsStatus');

function updateConnectionStatus(state = 'connecting', message) {
    if (!wsStatusChip) return;
    const textMap = {
        connecting: 'Connecting…',
        connected: 'Connected',
        reconnecting: 'Reconnecting…',
        error: 'Connection lost',
    };
    const chipText = wsStatusChip.querySelector('.chip-text');
    const display = message || textMap[state] || textMap.connecting;
    wsStatusChip.classList.remove('connecting', 'connected', 'reconnecting', 'error');
    wsStatusChip.classList.add(state);
    if (chipText) {
        chipText.textContent = display;
    } else {
        wsStatusChip.textContent = display;
    }
}

function scheduleReconnect() {
    const delay = Math.min(15000, 1000 * Math.pow(2, reconnectAttempts));
    reconnectAttempts += 1;
    const seconds = Math.round(delay / 1000);
    updateConnectionStatus('reconnecting', `Reconnecting in ${seconds}s…`);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        initWebSocket();
    }, delay);
}

function initWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }
    updateConnectionStatus(reconnectAttempts ? 'reconnecting' : 'connecting');
    ws = new WebSocket(`${protocol}://${host}`);
    ws.addEventListener('open', () => {
        reconnectAttempts = 0;
        updateConnectionStatus('connected');
    });
    ws.addEventListener('error', (event) => {
        console.error('WebSocket error:', event);
        updateConnectionStatus('error', 'Connection error');
        if (ws && ws.readyState !== WebSocket.CLOSED) {
            ws.close();
        }
    });
    ws.addEventListener('close', () => {
        scheduleReconnect();
    });
    ws.addEventListener('message', handleWebSocketMessage);
}

const entriesDiv = document.getElementById('entries');
const previewDiv = document.getElementById('preview');
const uploadArea = document.getElementById('uploadArea');
const fastaFileInput = document.getElementById('fastaFile');
const browseBtn = document.getElementById('browseBtn');
const entryCounter = document.getElementById('entryCounter');
const downloadSection = document.getElementById('downloadSection');
const contentWrapper = document.getElementById('contentWrapper');

// Loading overlay elements
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingTitle = document.getElementById('loadingTitle');
const loadingDescription = document.getElementById('loadingDescription');
const loadingTime = document.getElementById('loadingTime');
const showLoadingBtn = document.getElementById('showLoading');

// Download buttons
const downloadFastaBtn = document.getElementById('downloadFasta');
const downloadFullBtn = document.getElementById('downloadFull');
const downloadAnomalyBtn = document.getElementById('downloadAnomaly');
const downloadCSVBtn = document.getElementById('downloadCSV');
const historyBody = document.getElementById('historyBody');
const refreshHistoryBtn = document.getElementById('refreshHistory');
const saveConfigBtn = document.getElementById('saveConfig');
const configStatus = document.getElementById('configStatus');
const configModalEl = document.getElementById('configModal');
const nonAnomalyInlineInput = document.getElementById('nonAnomalyInline');
const speciesNameInlineInput = document.getElementById('speciesNameInline');
const heuristicStatus = document.getElementById('heuristicStatus');
const heuristicStatusIcon = heuristicStatus?.querySelector('.status-icon');
const heuristicStatusText = heuristicStatus?.querySelector('.status-text');

let entries = [];
let loadingStartTime = null;
let timerInterval = null;
let currentResults = [];
let configCache = {
    database: '',
    program: '',
    filterSelect: '',
    outputQty: '',
    nonAnomaly: '',
    speciesName: ''
};
let configReady = false;

function debounce(fn, delay = 600) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}

function setConfigStatus(message = "", type = "info") {
    if (!configStatus) return;
    configStatus.classList.remove('alert-info', 'alert-success', 'alert-danger');
    if (!message) {
        configStatus.classList.add('d-none');
        configStatus.textContent = "";
        return;
    }
    configStatus.classList.remove('d-none');
    configStatus.classList.add(`alert-${type}`);
    configStatus.textContent = message;
}

if (configModalEl) {
    ['show.bs.modal', 'hidden.bs.modal'].forEach(evt => {
        configModalEl.addEventListener(evt, () => setConfigStatus());
    });
}

function showHeuristicStatus(state = 'hidden', message = '') {
    if (!heuristicStatus) return;

    heuristicStatus.classList.remove('hidden', 'text-success', 'text-danger', 'text-muted', 'text-primary');
    if (state === 'hidden') {
        heuristicStatus.classList.add('hidden');
    } else if (state === 'success') {
        heuristicStatus.classList.add('text-success');
    } else if (state === 'error') {
        heuristicStatus.classList.add('text-danger');
    } else if (state === 'idle') {
        heuristicStatus.classList.add('text-muted');
    } else if (state === 'saving') {
        heuristicStatus.classList.add('text-primary');
    }

    const iconClasses = {
        saving: 'bi-arrow-repeat text-primary',
        success: 'bi-check-circle-fill text-success',
        error: 'bi-exclamation-triangle-fill text-danger',
        idle: 'bi-dash-circle text-muted'
    };

    if (state === 'hidden') {
        if (heuristicStatusIcon) {
            heuristicStatusIcon.className = 'status-icon bi';
        }
        if (heuristicStatusText) {
            heuristicStatusText.textContent = '';
        }
        return;
    }

    if (heuristicStatusIcon) {
        heuristicStatusIcon.className = `status-icon bi ${iconClasses[state] || 'bi-check-circle-fill text-success'}`;
    }
    if (heuristicStatusText) {
        heuristicStatusText.textContent = message;
    }
}

// Initialize with one blank entry
addEntry();

function updateCounter() {
    entryCounter.textContent = `${entries.length} sequence${entries.length !== 1 ? 's' : ''}`;
}

function addEntry(title = "", seq = "") {
    const index = entries.length;
    const wrapper = document.createElement('div');
    wrapper.className = 'sequence-entry';
    wrapper.innerHTML = `
        <div class="compact-grid">
            <div class="title-input">
                <input type="text" class="form-control" id="title_${index}" value="${title}" placeholder="Title">
            </div>
            <div class="sequence-input">
                <input type="text" class="form-control" id="seq_${index}" value="${seq}" placeholder="ATGCGTA...">
            </div>
            <button class="btn btn-sm btn-outline-danger remove-btn" onclick="removeEntry(${index})">×</button>
        </div>
    `;
    entriesDiv.appendChild(wrapper);
    entries.push({ title, seq });
    updateCounter();
}

function removeEntry(index) {
    entries.splice(index, 1);
    renderEntries();
}

function clearAll() {
    entries = [];
    renderEntries();
    previewDiv.innerHTML = "";
    downloadSection.style.display = 'none';
    
    // Remove sequence count if present
    const sequenceCount = uploadArea.querySelector('.sequence-count');
    if (sequenceCount) {
        sequenceCount.remove();
    }
}

function renderEntries() {
    entriesDiv.innerHTML = "";
    const temp = [...entries];
    entries = [];
    temp.forEach(e => addEntry(e.title, e.seq));
}

// Loading overlay functions
function showLoading() {
    loadingOverlay.classList.add('active');
    contentWrapper.classList.add('loading-blur');
    
    // Start timer
    loadingStartTime = new Date();
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

function hideLoading() {
    loadingOverlay.classList.remove('active');
    contentWrapper.classList.remove('loading-blur');
    
    // Clear timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function updateTimer() {
    if (!loadingStartTime) return;
    
    const now = new Date();
    const elapsed = Math.floor((now - loadingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    
    loadingTime.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function changeLoadingText() {
    const newTitle = prompt('Enter new loading title:', loadingTitle.textContent);
    if (newTitle !== null) {
        loadingTitle.textContent = newTitle;
    }
    
    const newDescription = prompt('Enter new loading description:', loadingDescription.textContent);
    if (newDescription !== null) {
        loadingDescription.textContent = newDescription;
    }
}

// Download functions
function downloadFasta(folderId) {
    const fid = folderId || localStorage.getItem('blid');
    if (!fid) {
        alert("No run selected yet.");
        return;
    }
    const queryString = new URLSearchParams({type: 4, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

function downloadAnomaly(folderId) {
    const fid = folderId || localStorage.getItem('blid');
    if (!fid) {
        alert("No run selected yet.");
        return;
    }
    const queryString = new URLSearchParams({type: 3, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

function downloadFull(folderId) {
    const fid = folderId || localStorage.getItem('blid');
    if (!fid) {
        alert("No run selected yet.");
        return;
    }
    const queryString = new URLSearchParams({type: 2, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

function downloadCSV(folderId) {
    const fid = folderId || localStorage.getItem('blid');
    if (!fid) {
        alert("No run selected yet.");
        return;
    }
    const queryString = new URLSearchParams({type: 1, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

// Handle file upload
function handleFileUpload(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        parseFastaContent(content);
    };
    reader.readAsText(file);
}

// Parse FASTA content and populate forms
function parseFastaContent(content) {
    // Clear existing entries
    entries = [];
    
    // Split content by ">" to get individual sequences
    const sequences = content.split('>').filter(seq => seq.trim());
    
    // If no sequences found, show error
    if (sequences.length === 0) {
        alert("No valid DNA sequences found in the file!");
        return;
    }
    
    // Parse each sequence
    sequences.forEach(seq => {
        const lines = seq.split('\n');
        const title = lines[0].trim();
        // Extract just the DNA sequence (remove any FASTA formatting)
        const sequence = lines.slice(1)
            .join('')
            .trim()
            .replace(/\s/g, '')
            .replace(/[^ATCGatcg]/g, ''); // Keep only DNA characters
        
        if (sequence) {
            entries.push({ title, seq: sequence.toUpperCase() });
        }
    });
    
    // Render the entries
    renderEntries();
    
    // Show success message
    let sequenceCount = uploadArea.querySelector('.sequence-count');
    if (!sequenceCount) {
        sequenceCount = document.createElement('div');
        sequenceCount.className = 'sequence-count';
        uploadArea.appendChild(sequenceCount);
    }
    sequenceCount.textContent = `Loaded ${entries.length} DNA sequence(s) from the file`;
}

// Event listeners for file upload
browseBtn.addEventListener('click', () => fastaFileInput.click());
fastaFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
    }
});

// Drag and drop functionality
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files[0]);
    }
});

// Download button event listeners
downloadFastaBtn.addEventListener('click', downloadFasta);
downloadFullBtn.addEventListener('click', downloadFull);
downloadAnomalyBtn.addEventListener('click', downloadAnomaly);
downloadCSVBtn.addEventListener('click', downloadCSV);

// Other event listeners
document.getElementById('addEntry').addEventListener('click', () => addEntry());
document.getElementById('clearAll').addEventListener('click', clearAll);

function updatePDFs(url1, url2) {
  document.getElementById('pdf1').src = url1;
  document.getElementById('pdf2').src = url2;
}

const icon = document.getElementById("loadingIcon");
let finished = 0;
const result = [];

const handleWebSocketMessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        if (data[0] == "folderid") {
            localStorage.setItem("blid", data[1]);
            localStorage.setItem("blid_red", data[1]);
        }
        
        if (Array.isArray(data)) {
            if (data[0] && data[0].toLowerCase().includes("complete")) {
                // Update preview with results
                previewDiv.innerHTML = currentResults.map(
                    (e, i) => `
                    <div class="preview-item">
                        <strong>${i + 1}. ${e.title}</strong><br>
                        <code>${e.sequence}</code>
                    </div>
                `).join("");

                hideLoading();
                downloadSection.style.display = 'block';
                downloadSection.scrollIntoView({ behavior: 'smooth' });

                let url = window.location.origin;
                const fid = localStorage.getItem('blid');
                const queryString = new URLSearchParams({type: 2, folderid: fid}).toString();
                let full_pdf = `${url}/preview?${queryString}`;
                const queryString2 = new URLSearchParams({type: 3, folderid: fid}).toString();
                let anomaly_pdf = `${url}/preview?${queryString2}`;

                updatePDFs(full_pdf, anomaly_pdf);
                loadHistory();

            }
            else if (data[0] && data[0].toLowerCase().includes("error")) {
                icon.className = "bi bi-x-circle-fill";
                icon.style.color = "red";
                loadingTitle.textContent = data[0];
                // Combine all error messages into the description
                loadingDescription.textContent = data.slice(1).filter(msg => msg).join(" | ") || 'An error occurred during processing';
            }
            else {
                // Handle multi-line progress updates
                if (data.length > 0) {
                    // Use first item as main title
                    loadingTitle.textContent = data[0] || 'Processing DNA Sequences';
                    
                    // Combine remaining items into description with line breaks
                    if (data.length > 1) {
                        const descriptionLines = data.slice(1).filter(line => line && line.trim() !== '');
                        loadingDescription.innerHTML = descriptionLines.map(line => 
                            `<div>${line}</div>`
                        ).join('');
                    } else {
                        loadingDescription.textContent = 'Processing... Please wait.';
                    }
                }
            }
        } else if (typeof data === 'object' && data !== null) {
            // Handle object format with specific fields
            if (data.status) {
                loadingTitle.textContent = data.status;
            }
            if (data.message) {
                loadingDescription.textContent = data.message;
            }
            if (data.messages && Array.isArray(data.messages)) {
                loadingDescription.innerHTML = data.messages.map(line => 
                    `<div>${line}</div>`
                ).join('');
            }
            if (data.progress) {
                loadingDescription.innerHTML += `<div><strong>Progress:</strong> ${data.progress}</div>`;
            }
            
            if (data.complete) {
                previewDiv.innerHTML = currentResults.map(
                    (e, i) => `
                    <div class="preview-item">
                        <strong>${i + 1}. ${e.title}</strong><br>
                        <code>${e.sequence}</code>
                    </div>
                `).join("");

                hideLoading();
                downloadSection.style.display = 'block';
                downloadSection.scrollIntoView({ behavior: 'smooth' });
                loadHistory();
            }
        } else {
            console.log("Received unexpected data format:", data);
        }
    } catch (error) {
        console.error("Error parsing WebSocket message:", error, "Raw data:", event.data);
        
        // If it's not JSON, treat it as plain text
        const message = event.data.toString();
        
        if (message.toLowerCase().includes("complete")) {
            previewDiv.innerHTML = currentResults.map(
                (e, i) => `
                <div class="preview-item">
                    <strong>${i + 1}. ${e.title}</strong><br>
                    <code>${e.sequence}</code>
                </div>
            `).join("");

            hideLoading();
            downloadSection.style.display = 'block';
            downloadSection.scrollIntoView({ behavior: 'smooth' });
            loadHistory();
        } else if (message.toLowerCase().includes("error")) {
            icon.className = "bi bi-x-circle-fill";
            icon.style.color = "red";
            loadingTitle.textContent = "Error";
            loadingDescription.textContent = message;
        } else {
            // Handle multi-line plain text
            const lines = message.split('\n').filter(line => line.trim() !== '');
            if (lines.length > 0) {
                loadingTitle.textContent = lines[0];
                if (lines.length > 1) {
                    loadingDescription.innerHTML = lines.slice(1).map(line => 
                        `<div>${line}</div>`
                    ).join('');
                }
            }
        }
    }
};

initWebSocket();

document.getElementById('submitAll').addEventListener('click', () => {
    let allTitlesFilled = true;

    entries.forEach((_, i) => {
        const title = document.getElementById(`title_${i}`)?.value.trim();
        const seq = document.getElementById(`seq_${i}`)?.value.trim().toUpperCase();

        // Ensure title is not empty
        if (!title) {
            alert(`Title for sequence ${i + 1} cannot be empty.`);
            allTitlesFilled = false;
            return;
        }

        if (seq) result.push({ title, sequence: seq });
    });

    if (!allTitlesFilled || result.length === 0) {
        alert("Please fix the errors before submitting.");
        return;
    }

    // Convert to FASTA format
    const fastaData = result.map(e => `>${e.title}\n${e.sequence}`).join("\n");

    // Store results for download
    currentResults = result;

    // Show loading during "processing"
    showLoading();
    loadingTitle.textContent = "Submitting DNA Sequences";
    loadingDescription.textContent = "Performing BLAST analysis and report generation...";

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert("Connection is unavailable. Reconnecting… please try again in a moment.");
        return;
    }

    // Send FASTA data over WebSocket
    ws.send(fastaData);
});

function normalizeConfig(config = {}) {
    return {
        database: config.database ?? config.db ?? '',
        program: config.program ?? config.programSelect ?? '',
        filterSelect: config.filterSelect ?? config.filter ?? '',
        outputQty: config.outputQty ?? config.output_qty ?? '',
        nonAnomaly: config.nonAnomaly ?? config.non_anomaly ?? '',
        speciesName: config.speciesName ?? config.species_name ?? ''
    };
}

function applyConfigToInputs(config) {
    const dbSelect = document.getElementById('dbSelect');
    const programSelect = document.getElementById('programSelect');
    const filterSelect = document.getElementById('filterSelect');
    const outputQty = document.getElementById('outputQty');

    if (dbSelect && config.database !== undefined) dbSelect.value = config.database;
    if (programSelect && config.program !== undefined) programSelect.value = config.program;
    if (filterSelect && config.filterSelect !== undefined) filterSelect.value = config.filterSelect;
    if (outputQty && config.outputQty !== undefined) outputQty.value = config.outputQty;

    if (nonAnomalyInlineInput && document.activeElement !== nonAnomalyInlineInput) {
        nonAnomalyInlineInput.value = config.nonAnomaly ?? '';
    }
    if (speciesNameInlineInput && document.activeElement !== speciesNameInlineInput) {
        speciesNameInlineInput.value = config.speciesName ?? '';
    }
}

function setConfigValues(config, options = {}) {
    const { silent = false } = options;
    const normalized = normalizeConfig(config);
    configCache = { ...configCache, ...normalized };
    applyConfigToInputs(normalized);
    configReady = true;

    if (silent) {
        showHeuristicStatus('hidden');
    } else if (normalized.nonAnomaly || normalized.speciesName) {
        showHeuristicStatus('success', 'Synced');
    } else {
        showHeuristicStatus('idle', 'Add values to begin auto-save');
    }
}

function collectFormSnapshot() {
    return {
        database: document.getElementById('dbSelect')?.value || '',
        program: document.getElementById('programSelect')?.value || '',
        filterSelect: document.getElementById('filterSelect')?.value || '',
        outputQty: document.getElementById('outputQty')?.value || '',
        nonAnomaly: nonAnomalyInlineInput?.value || '',
        speciesName: speciesNameInlineInput?.value || ''
    };
}

function buildPayload(overrides = {}) {
    const snapshot = collectFormSnapshot();
    return { ...snapshot, ...configCache, ...overrides };
}

async function persistConfig(overrides = {}) {
    const payload = buildPayload(overrides);
    const response = await fetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let message = 'Failed to save configuration.';
        try {
            const error = await response.json();
            message = error?.detail || message;
        } catch (_) {
            // ignore parse errors
        }
        throw new Error(message);
    }

    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }

    if (data?.config) {
        setConfigValues(data.config, { silent: true });
    } else {
        setConfigValues(payload, { silent: true });
    }

    return data;
}

if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
        const nonAnomalyValue = (nonAnomalyInlineInput?.value || '').trim();
        const speciesValue = (speciesNameInlineInput?.value || '').trim();
        const config = {
            database: document.getElementById('dbSelect').value,
            program: document.getElementById('programSelect').value,
            outputQty: document.getElementById('outputQty').value,
            filterSelect: document.getElementById('filterSelect').value,
            nonAnomaly: nonAnomalyValue,
            speciesName: speciesValue
        };

        const missing = Object.entries(config)
            .filter(([, value]) => !String(value || "").trim())
            .map(([key]) => key);

        if (missing.length) {
            setConfigStatus('Please fill out all configuration fields before saving.', 'danger');
            return;
        }

        try {
            setConfigStatus('Saving configuration…', 'info');
            saveConfigBtn.disabled = true;

            await persistConfig(config);
            showHeuristicStatus('success', 'Saved');

            setConfigStatus('Configuration saved successfully.', 'success');
            setTimeout(() => {
                const modal = bootstrap.Modal.getInstance(configModalEl);
                modal?.hide();
            }, 600);
        } catch (error) {
            console.error('Config save error:', error);
            setConfigStatus(error.message || 'Failed to save configuration.', 'danger');
        } finally {
            saveConfigBtn.disabled = false;
        }
    });
}

function formatHistoryDate(timestamp) {
    if (!timestamp) return '—';
    try {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return timestamp;
        return date.toLocaleString();
    } catch (error) {
        return timestamp;
    }
}

function renderHistory(entries) {
    if (!historyBody) return;
    if (!entries.length) {
        historyBody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center text-muted small py-3">
                    No completed BatchBLAST runs yet.
                </td>
            </tr>
        `;
        return;
    }

    const rows = entries.map(entry => {
        const previewDisabled = entry.has_full_report || entry.has_anomaly_report ? '' : 'disabled';
        return `
            <tr>
                <td class="fw-semibold text-break">${entry.id}</td>
                <td>${formatHistoryDate(entry.updated_at)}</td>
                <td>
                    <div class="history-badges">
                        <span class="history-badge ${entry.has_full_report ? '' : 'muted'}">Full PDF</span>
                        <span class="history-badge ${entry.has_anomaly_report ? '' : 'muted'}">Anomaly PDF</span>
                        <span class="history-badge ${entry.has_csv ? '' : 'muted'}">CSV</span>
                        <span class="history-badge ${entry.has_fasta ? '' : 'muted'}">FASTA</span>
                    </div>
                </td>
                <td>
                    <div class="history-actions">
                        <button class="btn btn-outline-primary btn-chip" data-action="preview" data-id="${entry.id}" ${previewDisabled}>
                            Preview
                        </button>
                        <button class="btn btn-outline-secondary btn-chip" data-action="download" data-type="full" data-id="${entry.id}" ${entry.has_full_report ? '' : 'disabled'}>
                            Full
                        </button>
                        <button class="btn btn-outline-secondary btn-chip" data-action="download" data-type="anomaly" data-id="${entry.id}" ${entry.has_anomaly_report ? '' : 'disabled'}>
                            Anomaly
                        </button>
                        <button class="btn btn-outline-secondary btn-chip" data-action="download" data-type="csv" data-id="${entry.id}" ${entry.has_csv ? '' : 'disabled'}>
                            CSV
                        </button>
                        <button class="btn btn-outline-secondary btn-chip" data-action="download" data-type="fasta" data-id="${entry.id}" ${entry.has_fasta ? '' : 'disabled'}>
                            FASTA
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    historyBody.innerHTML = rows;
}

async function loadHistory(showSpinner = false) {
    if (!historyBody) return;

    if (showSpinner) {
        historyBody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center text-muted small py-3">
                    Loading history…
                </td>
            </tr>
        `;
    }

    try {
        const response = await fetch('/history');
        if (!response.ok) {
            throw new Error('Unable to fetch history');
        }
        const data = await response.json();
        renderHistory(Array.isArray(data) ? data : []);
    } catch (error) {
        console.error('History fetch error:', error);
        historyBody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center text-danger small py-3">
                    Unable to load history.
                </td>
            </tr>
        `;
    }
}

function previewHistoryRun(folderId) {
    if (!folderId) return;
    const url = window.location.origin;

    const fullQuery = new URLSearchParams({type: 2, folderid: folderId}).toString();
    const anomalyQuery = new URLSearchParams({type: 3, folderid: folderId}).toString();

    updatePDFs(`${url}/preview?${fullQuery}`, `${url}/preview?${anomalyQuery}`);
    downloadSection.style.display = 'block';
    localStorage.setItem('blid', folderId);
    downloadSection.scrollIntoView({ behavior: 'smooth' });
}

if (historyBody) {
    historyBody.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const runId = button.getAttribute('data-id');
        const action = button.getAttribute('data-action');

        if (action === 'preview') {
            previewHistoryRun(runId);
            return;
        }

        if (action === 'download') {
            const type = button.getAttribute('data-type');
            switch (type) {
                case 'full':
                    downloadFull(runId);
                    break;
                case 'anomaly':
                    downloadAnomaly(runId);
                    break;
                case 'csv':
                    downloadCSV(runId);
                    break;
                case 'fasta':
                    downloadFasta(runId);
                    break;
                default:
                    break;
            }
        }
    });
}

if (refreshHistoryBtn) {
    refreshHistoryBtn.addEventListener('click', () => loadHistory(true));
}

document.addEventListener('DOMContentLoaded', function() {
    showHeuristicStatus('saving', 'Loading configuration…');
    fetch('/config')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(config => {
            setConfigValues(config, { silent: true });
        })
        .catch(error => {
            console.error('Config fetch error:', error);
            showHeuristicStatus('error', 'Failed to load config');
        });
    loadHistory(true);
});

const debounceHeuristicSave = debounce(async () => {
    if (!configReady) {
        return;
    }

    const keyword = (nonAnomalyInlineInput?.value || '').trim();
    const species = (speciesNameInlineInput?.value || '').trim();

    if (!keyword || !species) {
        showHeuristicStatus('hidden');
        return;
    }

    try {
        showHeuristicStatus('saving', 'Saving…');
        await persistConfig({ nonAnomaly: keyword, speciesName: species });
        showHeuristicStatus('success', 'Saved');
    } catch (error) {
        console.error('Auto-save error:', error);
        showHeuristicStatus('error', 'Save failed');
    }
}, 900);

if (nonAnomalyInlineInput) {
    nonAnomalyInlineInput.addEventListener('input', () => {
        configCache.nonAnomaly = nonAnomalyInlineInput.value;
        if (configReady) {
            showHeuristicStatus('hidden');
        }
        debounceHeuristicSave();
    });
}

if (speciesNameInlineInput) {
    speciesNameInlineInput.addEventListener('input', () => {
        configCache.speciesName = speciesNameInlineInput.value;
        if (configReady) {
            showHeuristicStatus('hidden');
        }
        debounceHeuristicSave();
    });
}
