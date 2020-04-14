/**
 * Skip Silence Browser Extension:
 * Skip silent parts in videos and audio files.
 * 
 * Content script: Speed up and slow down source, measure volume using audio analyser
 * 
 * @author vantezzen (https://github.com/vantezzen)
 * @license MIT License
 */
// Currently disabled: Log info to page console
const debug = log => {
  // console.log('[Skip Silence] ' + log);
}

// Configuration ('server' default values)
const CONFIG_DEFAULTS = {
  threshold: 30,
  samples_threshold: 10,
  audio_delay: 0.08,
  playback_speed: 1,
  silence_speed: 3,
  enabled: false,
  timeSaved: 0,
  timeSavedAllTime: 0,
}
let config = Object.assign({}, CONFIG_DEFAULTS);;


// Enable or disable browser action for current tab using background script
const enableExtension = () => {
  chrome.runtime.sendMessage({ command: 'enable' });  
}
const disableExtension = () => {
  chrome.runtime.sendMessage({ command: 'disable' });  
}

// Create audio context to source element
const attachAnalyser = element => {
  debug('Attaching analyser');
  const audio = new AudioContext();
  audio.crossOrigin = 'anonymous';
  // Create Context components
  const analyser = audio.createAnalyser();
  const source = audio.createMediaElementSource(element);
  const delay = audio.createDelay();
  const gain = audio.createGain();
  
  delay.delayTime.setValueAtTime(config.audio_delay, audio.currentTime);

  // Connect components
  source.connect(analyser);
  analyser.connect(delay);
  delay.connect(gain);
  gain.connect(audio.destination);

  return [
    analyser,
    gain,
    audio
  ];
}

debug('Hello');

// Prepare extension on current page to listen for messages from popup and control the source element
const prepareExtension = () => {
  debug('Preparing extension');

  // Get video or audio element from page
  let element;
  if (document.getElementsByTagName('video').length) {
    element = document.getElementsByTagName('video')[0];
    enableExtension();
  } else if (document.getElementsByTagName('audio').length) {
    enableExtension();
    element = document.getElementsByTagName('audio')[0];
  } else {
    // No audio or video existent on page - disable extension
    debug('No source found');
    disableExtension();
    return;
  }

  debug('Found video or audio source');

  // Information for speeding up and down the video
  let isAnalyserAttached = false; // Is the AudioContext and analyser currently attached to the source?
  let analyser, gain, audio; // AudioContext elements
  let freq_volume; // Current frequency volume information of source (Float32Array)
  let isSpedUp = false; // Is the source currently sped up?
  let samplesUnderThreshold = 0; // Number of samples we have been under threshold
  let prevTime = 0;
  config.timeSaved = 0;
  const run = () => {
    if (!config.enabled) return;

    if (!isAnalyserAttached) {
      isAnalyserAttached = true;
      [ analyser, gain, audio ] = attachAnalyser(element);
      freq_volume = new Float32Array(analyser.fftSize);
    }
    analyser.getFloatTimeDomainData(freq_volume);

    // Compute volume via peak instantaneous power over the interval
    let peakInstantaneousPower = 0;
    for (let i = 0; i < freq_volume.length; i++) {
      const power = freq_volume[i];
      peakInstantaneousPower = Math.max(power, peakInstantaneousPower);
    }
    const volume = (500 * peakInstantaneousPower);

    // Check volume
    if (volume < config.threshold && !element.paused) {
      samplesUnderThreshold++;
  
      if (!isSpedUp && samplesUnderThreshold >= config.samples_threshold) {
        // Speed up video
        element.playbackRate = config.silence_speed;
        isSpedUp = true;
        prevTime = audio.currentTime;
        chrome.runtime.sendMessage({ command: 'up' }); 
      }
    } else {
      if (isSpedUp) {
        // Slow video back down
        // Mute source for short amount of time to improve clipping noises when slowing back down
        // This won't solve the issue completely but seems to help a little
        gain.gain.setValueAtTime(0, audio.currentTime);
        gain.gain.setValueAtTime(1, audio.currentTime + 1.1 * config.audio_delay);
  
        element.playbackRate = config.playback_speed;
        isSpedUp = false;
        let timeSaved = (audio.currentTime - prevTime) * (1/config.playback_speed - 1/config.silence_speed);
        config.timeSaved += timeSaved;
        config.timeSavedAllTime += timeSaved;
        chrome.runtime.sendMessage({ command: 'down', data: [config.timeSaved, config.timeSavedAllTime] }); 
      }
      samplesUnderThreshold = 0;
    }

    // Report current volume to popup for VU Meter
    chrome.runtime.sendMessage({ command: 'vol', data: volume }); 
    
    if (config.enabled) {
      requestAnimationFrame(run);
    }
  }

  // load config
  chrome.storage.local.get(['config'], function(result) {
    if (result.config !== undefined) {
      config = result.config;
      if (config.enabled) {
        chrome.runtime.sendMessage({command: "enable-rt"});
        requestAnimationFrame(run);
      }
    }
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg.command) return;
  
    if (msg.command === 'config') {
      // Update source speed based on new config
      if (!msg.data.enabled && config.enabled) {
        // Extension has just been disabled - set playback speed back to 1x
        element.playbackRate = 1;
        chrome.runtime.sendMessage({command: "disable-rt"});
      } else if (msg.data.enabled && !config.enabled) {
        // Extension has just been enabled - start extension
        element.playbackRate = msg.data.playback_speed;
        config.enabled = true;
        chrome.runtime.sendMessage({command: "enable-rt"});
        run();
      } else if (isSpedUp) {
        element.playbackRate = msg.data.silence_speed;
      } else {
        element.playbackRate = msg.data.playback_speed;
      }
      config = msg.data;
      chrome.storage.local.set({'config': config});
    } else if (msg.command === 'requestConfig') {
      // Send our current config back to popup
      sendResponse(config);
    }
  })
}

// Prepare extension after DOM is ready to make sure source elements are loaded
if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(prepareExtension, 1);
} else {
  document.addEventListener("DOMContentLoaded", prepareExtension);
}
