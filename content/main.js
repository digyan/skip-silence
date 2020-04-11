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

// Configuration
let THRESHOLD = 30;
let SAMPLES_THRESHOLD = 10;
let AUDIO_DELAY = 0.08;
let PLAYBACK_SPEED = 1;
let SILENCE_SPEED = 3;
let IS_ENABLED = false;

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

  delay.delayTime.setValueAtTime(AUDIO_DELAY, audio.currentTime);

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
    element.crossOrigin = 'anonymous';
    enableExtension();
  } else if (document.getElementsByTagName('audio').length) {
    enableExtension();
    element = document.getElementsByTagName('audio')[0];
    element.crossOrigin = 'anonymous';
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

  const run = () => {
    if (!IS_ENABLED) return;

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

    debug('Volume');
    // Check volume
    if (volume < THRESHOLD && !element.paused) {
      samplesUnderThreshold++;
  
      if (!isSpedUp && samplesUnderThreshold >= SAMPLES_THRESHOLD) {
        // Speed up video
        element.playbackRate = SILENCE_SPEED;
        isSpedUp = true;

        chrome.runtime.sendMessage({ command: 'speed up' }); 
      }
    } else {
      if (isSpedUp) {
        // Slow video back down
        // Mute source for short amount of time to improve clipping noises when slowing back down
        // This won't solve the issue completely but seems to help a little
        gain.gain.setValueAtTime(0, audio.currentTime);
        gain.gain.setValueAtTime(1, audio.currentTime + 1.1 * AUDIO_DELAY);
  
        element.playbackRate = PLAYBACK_SPEED;
        isSpedUp = false;

        chrome.runtime.sendMessage({ command: 'slow down' }); 
      }
      samplesUnderThreshold = 0;
    }

    // Report current volume to popup for VU Meter
    chrome.runtime.sendMessage({ command: 'volume', data: volume }); 
  
    if (IS_ENABLED) {
      requestAnimationFrame(run);
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg.command) return;
  
    if (msg.command === 'config') {
      // Update source speed based on new config
      if (!msg.data.enabled && IS_ENABLED) {
        // Extension has just been disabled - set playback speed back to 1x
        element.playbackRate = 1;
        debug('Disabled');
      } else if (msg.data.enabled && !IS_ENABLED) {
        // Extension has just been enabled - start extension
        element.playbackRate = msg.data.playback_speed;
        IS_ENABLED = true;
        run();
        debug('Enabled');
      } else if (isSpedUp) {
        element.playbackRate = msg.data.silence_speed;
      } else {
        element.playbackRate = msg.data.playback_speed;
      }

      THRESHOLD = msg.data.threshold;
      SAMPLES_THRESHOLD = msg.data.samples_threshold;
      AUDIO_DELAY = msg.data.audio_delay;
      PLAYBACK_SPEED = msg.data.playback_speed;
      SILENCE_SPEED = msg.data.silence_speed;
      IS_ENABLED = msg.data.enabled;
    } else if (msg.command === 'requestConfig') {
      // Send our current config back to popup
      sendResponse({
        threshold: THRESHOLD,
        samples_threshold: SAMPLES_THRESHOLD,
        audio_delay: AUDIO_DELAY,
        playback_speed: PLAYBACK_SPEED,
        silence_speed: SILENCE_SPEED,
        enabled: IS_ENABLED,
      });
    }
  })
}

// Prepare extension after DOM is ready to make sure source elements are loaded
if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(prepareExtension, 1);
} else {
  document.addEventListener("DOMContentLoaded", prepareExtension);
}