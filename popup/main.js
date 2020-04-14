/**
 * Skip Silence Browser Extension:
 * Skip silent parts in videos and audio files.
 * 
 * Popup: Manage settings and show a VU Meter to visualize what it is currently doing
 * 
 * @author vantezzen (https://github.com/vantezzen)
 * @license MIT License
 */
const canvas_element = document.getElementById('vu_meter');
let canvasScale = canvas_element.width / canvas_element.clientWidth;
const canvas = canvas_element.getContext('2d');
const CONFIG_DEFAULTS = { // this is 'client' default values
  threshold: 30,
  samples_threshold: 10,
  audio_delay: 0.08,
  playback_speed: 1,
  silence_speed: 3,
  enabled: false,
  timeSaved: 0,
  timeSavedAllTime: 0,
}
let config = Object.assign({}, CONFIG_DEFAULTS);
let volume = 0;
let isSpedUp = false;

const OFFSET = 10;
const HEIGHT_OFFSET = 40;

// Render VU Meter to canvas element
const renderVUMeter = () => {
  // Clear current contents
  canvas.clearRect(0, 0, canvas_element.width, canvas_element.height);

  // Render Threshold bar
  canvas.fillStyle = '#910000';  
  canvas.fillRect(OFFSET, 0, config.threshold, canvas_element.height);

  // VU Meter color changes based on if the video is currently sped up
  if (isSpedUp) {
    canvas.fillStyle = '#f52a2a';
  } else {
    canvas.fillStyle = '#00CCFF';
  }

  // Render VU Meter bar
  canvas.fillRect(0, 0, OFFSET, canvas_element.height);

  canvas.fillRect(OFFSET, 0, Math.min(volume, canvas_element.width - OFFSET), canvas_element.height-HEIGHT_OFFSET);

  // Loop render via animation frames
  requestAnimationFrame(renderVUMeter);
}

// Send updated config to site
const sendConfig = () => {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {
      command: 'config',
      data: config,
    });
  });
}
// Request current config from site
const requestConfig = () => {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {
      command: 'requestConfig',
    }, function(response) {
      config = response;
      updatePageInputs();
    });
  });
}

// Convert seconds to HH:MM:SS https://stackoverflow.com/a/34841026
var toHHMMSS = (secs) => {
  var sec_num = parseInt(secs, 10)
  var hours   = Math.floor(sec_num / 3600)
  var minutes = Math.floor(sec_num / 60) % 60
  var seconds = sec_num % 60

  return [hours,minutes,seconds]
      .map(v => v < 10 ? "0" + v : v)
      .filter((v,i) => v !== "00" || i > 0)
      .join(":")
}

// Update the page input elements to reflect the current config
const updatePageInputs = () => {
  document.getElementById('enable-toggle').checked = config.enabled;
  document.getElementById('samples').value = config.samples_threshold;
  document.getElementById('playback').value = config.playback_speed;
  document.getElementById('silence').value = config.silence_speed;
  document.getElementById('timesaved-val').innerHTML = toHHMMSS(config.timeSaved);
  document.getElementById('alltime-timesaved-val').innerHTML = toHHMMSS(config.timeSavedAllTime);
  document.getElementById('playback-val').value = config.playback_speed + "x";
  document.getElementById('silence-val').value = config.silence_speed + "x";
}

// Listen for messages from the page to update our config
chrome.runtime.onMessage.addListener(msg => {
  if (!msg.command) return;

  if (msg.command === 'vol') {
    volume = msg.data;
  } else if (msg.command === 'up') {
    isSpedUp = true;
  } else if (msg.command === 'down') {
    isSpedUp = false;
    config.timeSaved = msg.data[0];
    config.timeSavedAllTime = msg.data[1];
    document.getElementById('timesaved-val').innerHTML = toHHMMSS(config.timeSaved);
    document.getElementById('alltime-timesaved-val').innerHTML = toHHMMSS(config.timeSavedAllTime);
  }
});

// Listen for changes on input/setting elements
document.getElementById('enable-toggle').addEventListener('click', event => {
  config.enabled = event.target.checked;
  sendConfig();

  // Update VU Meter to be empty - otherwise it will be stuck on the latest value
  if (!config.enabled) {
    volume = 0;
    isSpedUp = false;
  }
});
document.getElementById('samples').addEventListener('input', event => {
  config.samples_threshold = Number(event.target.value);
  sendConfig();
});
document.getElementById('playback').addEventListener('input', event => {
  config.playback_speed = Number(event.target.value);
  document.getElementById('playback-val').value = event.target.value + "x";
  sendConfig();
});
document.getElementById('silence').addEventListener('input', event => {
  config.silence_speed = Number(event.target.value);
  document.getElementById('silence-val').value = event.target.value + "x";
  sendConfig();
});
document.getElementById('reset-btn').addEventListener('click', event => {
  config = Object.assign({}, CONFIG_DEFAULTS);
  sendConfig();
  volume = 0;
  isSpedUp = false;
  updatePageInputs();
});

const getMousePos = (canvas, evt) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top
  };
}

canvas_element.addEventListener('mousedown', function(e) {
  const {x, y} = getMousePos(canvas_element, e);
  config.threshold = Number(canvasScale*x-OFFSET);
  sendConfig();
});

requestConfig();

// Start VU Meter render loop
renderVUMeter();