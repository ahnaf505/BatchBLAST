const host = window.location.host;
let ws;
ws = new WebSocket(`ws://${host}`);
ws.onclose = () => {
    ws = new WebSocket(`ws://${host}`);
};

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
let currentResults = [];

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
function downloadFasta() {
    const fid = localStorage.getItem('blid');
    const queryString = new URLSearchParams({type: 4, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

function downloadAnomaly() {
    const fid = localStorage.getItem('blid');
    const queryString = new URLSearchParams({type: 3, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

function downloadFull() {
    const fid = localStorage.getItem('blid');
    const queryString = new URLSearchParams({type: 2, folderid: fid}).toString();
    window.location.href = `/download?${queryString}`;
}

function downloadCSV() {
    const fid = localStorage.getItem('blid');
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

ws.onmessage = (event) => {
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

    // Send FASTA data over WebSocket
    ws.send(fastaData);
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
