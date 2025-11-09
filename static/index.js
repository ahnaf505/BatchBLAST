const host = window.location.host;
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${wsProtocol}://${host}`;
const WS_RECONNECT_DELAY = 2000;
let ws = null;
let reconnectTimer = null;
let connectTimeout = null;
const STORAGE_KEYS = {
    jobId: 'blastJobId',
    jobStatus: 'blastJobStatus',
    jobStart: 'blastJobStart',
    folderId: 'blid',
    preview: 'blastJobPreview'
};

let activeJobId = localStorage.getItem(STORAGE_KEYS.jobId) || null;

const wsStatus = document.getElementById('wsStatus');
const wsStatusIcon = document.getElementById('wsStatusIcon');
const wsStatusText = document.getElementById('wsStatusText');

const wsStateConfig = {
    connecting: {
        icon: 'bi-arrow-repeat',
        color: '#ffc107',
        text: 'Connecting…'
    },
    connected: {
        icon: 'bi-circle-fill',
        color: '#28a745',
        text: 'Connected'
    },
    disconnected: {
        icon: 'bi-wifi-off',
        color: '#fd7e14',
        text: 'Reconnecting…'
    },
    error: {
        icon: 'bi-exclamation-triangle-fill',
        color: '#dc3545',
        text: 'Error'
    }
};

function setJobStatus(status) {
    if (status) {
        localStorage.setItem(STORAGE_KEYS.jobStatus, status);
    } else {
        localStorage.removeItem(STORAGE_KEYS.jobStatus);
    }
}

function setJobStartTimestamp(value) {
    if (value) {
        localStorage.setItem(STORAGE_KEYS.jobStart, String(value));
    } else {
        localStorage.removeItem(STORAGE_KEYS.jobStart);
    }
}

function shouldAttemptResume() {
    return (
        !!localStorage.getItem(STORAGE_KEYS.jobId) &&
        localStorage.getItem(STORAGE_KEYS.jobStatus) === 'running'
    );
}

function getStoredStartTime() {
    const ts = localStorage.getItem(STORAGE_KEYS.jobStart);
    return ts ? Number(ts) : null;
}

function persistFolderId(folderId) {
    if (folderId) {
        localStorage.setItem(STORAGE_KEYS.folderId, folderId);
    }
}

function persistPreview(entries) {
    if (!entries || !entries.length) {
        localStorage.removeItem(STORAGE_KEYS.preview);
        return;
    }

    try {
        localStorage.setItem(STORAGE_KEYS.preview, JSON.stringify(entries));
    } catch (storageError) {
        console.warn('Failed to persist preview', storageError);
    }
}

function restorePreviewFromStorage() {
    const cached = localStorage.getItem(STORAGE_KEYS.preview);
    if (!cached) {
        return [];
    }
    try {
        return JSON.parse(cached);
    } catch (parseError) {
        console.warn('Failed to parse cached preview', parseError);
        return [];
    }
}

function clearJobTracking(preserveFolder = true) {
    activeJobId = null;
    localStorage.removeItem(STORAGE_KEYS.jobId);
    setJobStatus(null);
    setJobStartTimestamp(null);
    if (!preserveFolder) {
        localStorage.removeItem(STORAGE_KEYS.folderId);
    }
}

function updateWsStatus(state) {
    if (!wsStatus || !wsStatusIcon || !wsStatusText) return;
    const config = wsStateConfig[state] || wsStateConfig.disconnected;
    wsStatus.dataset.state = state;
    wsStatus.setAttribute('aria-label', `WebSocket status: ${config.text}`);
    wsStatusIcon.className = `bi ${config.icon} ws-status-icon`;
    wsStatusIcon.style.color = config.color;
    wsStatusIcon.classList.toggle('ws-status-spin', state === 'connecting');
    wsStatusText.textContent = config.text;
}

function clearConnectTimeout() {
    if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
    }
}

function startConnectTimeout() {
    clearConnectTimeout();
    connectTimeout = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            console.warn('WebSocket connect timeout; retrying.');
            try {
                ws.close(4000, 'Connection timeout');
            } catch (timeoutError) {
                console.error('Error closing timed-out WebSocket:', timeoutError);
            }
        }
    }, WS_RECONNECT_DELAY);
}

function teardownSocket(socket, code = 1000, reason = 'Reconnecting') {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    if (socket.readyState !== WebSocket.CLOSED) {
        try {
            socket.close(code, reason);
        } catch (closeError) {
            console.error('Error closing WebSocket:', closeError);
        }
    }
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket(true);
    }, WS_RECONNECT_DELAY);
}

function connectWebSocket(force = false) {
    if (ws) {
        const readyState = ws.readyState;
        if (!force && (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING)) {
            return;
        }

        if (force) {
            const staleSocket = ws;
            ws = null;
            clearConnectTimeout();
            teardownSocket(staleSocket);
        }
    }

    updateWsStatus('connecting');

    let nextSocket;
    try {
        nextSocket = new WebSocket(wsUrl);
    } catch (error) {
        console.error('WebSocket initialization failed:', error);
        updateWsStatus('error');
        scheduleReconnect();
        return;
    }

    ws = nextSocket;
    startConnectTimeout();

    nextSocket.onopen = () => {
        clearConnectTimeout();
        ws = nextSocket;  // ensure active reference
        updateWsStatus('connected');
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        if (shouldAttemptResume()) {
            const resumeJobId = localStorage.getItem(STORAGE_KEYS.jobId);
            const storedStart = getStoredStartTime();
            if (resumeJobId) {
                if (!loadingOverlay.classList.contains('active')) {
                    showLoading(storedStart);
                } else if (storedStart) {
                    loadingStartTime = new Date(storedStart);
                    updateTimer();
                }
                const resumePayload = {
                    action: 'resume',
                    jobId: resumeJobId
                };
                try {
                    nextSocket.send(JSON.stringify(resumePayload));
                } catch (resumeError) {
                    console.error('Failed to request resume', resumeError);
                }
            }
        }
    };

    nextSocket.onmessage = handleWebSocketMessage;

    nextSocket.onclose = () => {
        if (ws === nextSocket) {
            ws = null;
        }
        clearConnectTimeout();
        updateWsStatus('disconnected');
        scheduleReconnect();
    };

    nextSocket.onerror = (event) => {
        console.error('WebSocket error:', event);
        if (ws === nextSocket) {
            updateWsStatus('error');
        }
        clearConnectTimeout();
        try {
            nextSocket.close();
        } catch (closeError) {
            console.error('Error closing WebSocket after failure:', closeError);
        }
    };
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
const configAlert = document.getElementById('configAlert');
let configAlertTimeout = null;

let entries = [];
let loadingStartTime = null;
let timerInterval = null;
let currentResults = restorePreviewFromStorage();

// Initialize with one blank entry
addEntry();
updatePreviewUI(currentResults);

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
function showLoading(startTimeOverride = null) {
    loadingOverlay.classList.add('active');
    contentWrapper.classList.add('loading-blur');
    
    // Start timer
    loadingStartTime = startTimeOverride ? new Date(startTimeOverride) : new Date();
    updateTimer();
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    timerInterval = setInterval(updateTimer, 1000);
}

function hideLoading() {
    loadingOverlay.classList.remove('active');
    contentWrapper.classList.remove('loading-blur');
    loadingStartTime = null;
    
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
function downloadFasta() {
    const fid = localStorage.getItem(STORAGE_KEYS.folderId);
    const queryString = new URLSearchParams({type: 4, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

function downloadAnomaly() {
    const fid = localStorage.getItem(STORAGE_KEYS.folderId);
    const queryString = new URLSearchParams({type: 3, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

function downloadFull() {
    const fid = localStorage.getItem(STORAGE_KEYS.folderId);
    const queryString = new URLSearchParams({type: 2, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

function downloadCSV() {
    const fid = localStorage.getItem(STORAGE_KEYS.folderId);
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

function resetLoadingIcon() {
    icon.className = "bi bi-arrow-repeat spinner";
    icon.style.color = "#0d6efd";
}

function ensureLoadingActive(startOverride = null) {
    const storedStart = startOverride ?? getStoredStartTime();
    if (!loadingOverlay.classList.contains('active')) {
        showLoading(storedStart);
    } else if (storedStart) {
        loadingStartTime = new Date(storedStart);
    }
}

function applyStatusPayload(payload) {
    if (!payload) return;

    if (Array.isArray(payload)) {
        const [title, ...rest] = payload;
        if (title) {
            loadingTitle.textContent = title;
        }
        if (rest.length) {
            loadingDescription.innerHTML = rest
                .filter(Boolean)
                .map(line => `<div>${line}</div>`)
                .join('');
        }
        return;
    }

    if (typeof payload === 'string') {
        loadingTitle.textContent = payload;
        loadingDescription.textContent = '';
        return;
    }

    if (typeof payload === 'object') {
        if (payload.title) {
            loadingTitle.textContent = payload.title;
        }
        if (payload.message) {
            loadingDescription.textContent = payload.message;
        }
        if (Array.isArray(payload.lines)) {
            loadingDescription.innerHTML = payload.lines
                .filter(Boolean)
                .map(line => `<div>${line}</div>`)
                .join('');
        }
        if (Array.isArray(payload.messages)) {
            loadingDescription.innerHTML = payload.messages
                .filter(Boolean)
                .map(line => `<div>${line}</div>`)
                .join('');
        }
    }
}

function updatePreviewUI(entries = currentResults) {
    if (!entries || !entries.length) {
        previewDiv.innerHTML = '<p class="text-muted">No sequences queued.</p>';
        return;
    }

    previewDiv.innerHTML = entries
        .map((e, i) => `
            <div class="preview-item">
                <strong>${i + 1}. ${e.title}</strong><br>
                <code>${e.sequence}</code>
            </div>
        `)
        .join("");
}

function showDownloadSectionForFolder(folderId, scrollIntoView = false) {
    if (!folderId) return;
    downloadSection.style.display = 'block';

    const baseUrl = window.location.origin;
    const fullQuery = new URLSearchParams({ type: 2, folderid: folderId }).toString();
    const anomalyQuery = new URLSearchParams({ type: 3, folderid: folderId }).toString();

    updatePDFs(`${baseUrl}/preview?${fullQuery}`, `${baseUrl}/preview?${anomalyQuery}`);
    if (scrollIntoView) {
        downloadSection.scrollIntoView({ behavior: 'smooth' });
    }
}

function handleJobCompletion(payload) {
    setJobStatus('completed');
    setJobStartTimestamp(null);
    localStorage.removeItem(STORAGE_KEYS.jobId);
    resetLoadingIcon();
    hideLoading();

    applyStatusPayload(payload);

    if (!currentResults.length) {
        currentResults = restorePreviewFromStorage();
    }
    updatePreviewUI(currentResults);
    showDownloadSectionForFolder(localStorage.getItem(STORAGE_KEYS.folderId), true);
}

function handleJobError(payload) {
    setJobStatus('error');
    clearJobTracking(false);
    ensureLoadingActive();
    icon.className = "bi bi-x-circle-fill";
    icon.style.color = "red";
    loadingTitle.textContent = 'Error';
    loadingDescription.textContent = 'An error occurred during processing';
    applyStatusPayload(payload);
    persistPreview([]);
    currentResults = [];
    downloadSection.style.display = 'none';
    updatePreviewUI([]);
}

function restoreUIFromStorage() {
    if (currentResults.length) {
        updatePreviewUI(currentResults);
    }

    const status = localStorage.getItem(STORAGE_KEYS.jobStatus);
    const storedJobId = localStorage.getItem(STORAGE_KEYS.jobId);

    if (status === 'completed') {
        showDownloadSectionForFolder(localStorage.getItem(STORAGE_KEYS.folderId));
    } else if (status === 'running' && storedJobId) {
        const storedStart = getStoredStartTime();
        showLoading(storedStart);
        loadingTitle.textContent = "Reconnecting to BLAST job";
        loadingDescription.textContent = "Re-establishing connection to restore progress updates...";
    }
}

function handleWebSocketMessage(event) {
    let data;
    try {
        data = JSON.parse(event.data);
    } catch (parseError) {
        console.error("Error parsing WebSocket message:", parseError, "Raw data:", event.data);
        return;
    }

    if (Array.isArray(data)) {
        ensureLoadingActive();
        applyStatusPayload(data);
        return;
    }

    if (!data || typeof data !== 'object') {
        console.warn("Received unexpected data format:", data);
        return;
    }

    const { type, jobId, payload } = data;

    if (jobId) {
        activeJobId = jobId;
        localStorage.setItem(STORAGE_KEYS.jobId, jobId);
    }

    switch (type) {
        case 'job_ack': {
            const now = Date.now();
            setJobStatus('running');
            setJobStartTimestamp(now);
            ensureLoadingActive(now);
            resetLoadingIcon();
            break;
        }
        case 'resume_ack': {
            setJobStatus('running');
            ensureLoadingActive();
            resetLoadingIcon();
            break;
        }
        case 'job_started':
        case 'progress': {
            setJobStatus('running');
            ensureLoadingActive();
            resetLoadingIcon();
            applyStatusPayload(payload);
            break;
        }
        case 'folder': {
            if (payload && payload.folderId) {
                persistFolderId(payload.folderId);
            }
            break;
        }
        case 'complete': {
            handleJobCompletion(payload);
            break;
        }
        case 'error': {
            handleJobError(payload);
            break;
        }
        default: {
            console.warn('Unhandled WebSocket event', data);
            break;
        }
    }
}

connectWebSocket();

document.getElementById('submitAll').addEventListener('click', () => {
    let allTitlesFilled = true;
    const submissionResults = [];

    entries.forEach((_, i) => {
        const title = document.getElementById(`title_${i}`)?.value.trim();
        const seq = document.getElementById(`seq_${i}`)?.value.trim().toUpperCase();

        if (!title) {
            alert(`Title for sequence ${i + 1} cannot be empty.`);
            allTitlesFilled = false;
            return;
        }

        if (seq) {
            submissionResults.push({ title, sequence: seq });
        }
    });

    if (!allTitlesFilled || submissionResults.length === 0) {
        alert("Please fix the errors before submitting.");
        return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert("Reconnecting to the server. Please try again in a moment.");
        connectWebSocket(true);
        return;
    }

    const fastaData = submissionResults.map(e => `>${e.title}\n${e.sequence}`).join("\n");
    currentResults = submissionResults.map(entry => ({ ...entry }));
    persistPreview(currentResults);
    updatePreviewUI(currentResults);
    clearJobTracking(true);
    downloadSection.style.display = 'none';
    resetLoadingIcon();
    showLoading();
    loadingTitle.textContent = "Submitting DNA Sequences";
    loadingDescription.textContent = "Performing BLAST analysis and report generation...";

    const startPayload = {
        action: 'start',
        fasta: fastaData
    };

    try {
        ws.send(JSON.stringify(startPayload));
    } catch (sendError) {
        console.error('Failed to send BLAST request:', sendError);
        alert('Unable to start BLAST job. Please retry.');
        hideLoading();
    }
});

function showConfigAlert(type, message) {
  if (!configAlert) {
    window.alert(message);
    return;
  }

  configAlert.className = `alert alert-${type} position-fixed top-0 start-50 translate-middle-x shadow`;
  configAlert.textContent = message;
  configAlert.classList.remove('d-none');

  if (configAlertTimeout) {
    clearTimeout(configAlertTimeout);
  }

  configAlertTimeout = setTimeout(() => {
    configAlert.classList.add('d-none');
  }, 4000);
}

function setConfigValues(config) {
  const {
    database,
    program,
    filterSelect,
    outputQty,
    nonAnomaly,
    speciesName
  } = config;

  if (database) document.getElementById('dbSelect').value = database;
  if (program) document.getElementById('programSelect').value = program;
  if (filterSelect) document.getElementById('filterSelect').value = filterSelect;
  if (outputQty) document.getElementById('outputQty').value = outputQty;
  if (nonAnomaly) document.getElementById('nonAnomalyKeyword').value = nonAnomaly;
  if (speciesName) document.getElementById('speciesName').value = speciesName;
}

document.getElementById('saveConfig').addEventListener('click', () => {
  const config = {
    database: document.getElementById('dbSelect').value,
    program: document.getElementById('programSelect').value,
    outputQty: document.getElementById('outputQty').value,
    filterSelect: document.getElementById('filterSelect').value,
    nonAnomaly: document.getElementById('nonAnomalyKeyword').value,
    speciesName: document.getElementById('speciesName').value
  };

  const missingField = Object.entries(config).find(([, value]) => !value);
  if (missingField) {
    showConfigAlert('warning', 'Please fill in all configuration fields before saving.');
    return;
  }

  fetch('/saveconfig', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(config)
  })
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to save configuration');
      }
      return response.json();
    })
    .then(data => {
      if (data?.config) {
        setConfigValues(data.config);
      }

      const modalElement = document.getElementById('configModal');
      const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
      modal.hide();
      showConfigAlert('success', 'Configuration saved successfully.');
    })
    .catch(error => {
      console.error('Config save error:', error);
      showConfigAlert('danger', 'Unable to save configuration. Please try again.');
    });
});

document.addEventListener('DOMContentLoaded', function() {
    restoreUIFromStorage();
    fetch('/getconfig')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            setConfigValues(data);
        })
        .catch(error => {
            console.error('Config fetch error:', error);
        });

});
