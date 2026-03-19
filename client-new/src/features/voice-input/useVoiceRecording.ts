import { useState, useRef, useCallback } from 'react';
import type { AppLanguage } from '../../shared/i18n/translations';
import { getSpeechLocale } from '../../shared/i18n/translations';

/**
 * Hook for voice recording and visualization
 */
export function useVoiceRecording(language: AppLanguage = 'ru') {
  const [isRecording, setIsRecording] = useState(false);
  const [amplitude, setAmplitude] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const recognitionRef = useRef<any>(null);

  const silenceTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'recording' | 'error' | 'connecting'>('idle');
  const [errorCount, setErrorCount] = useState(0);

  const startRecording = async (onSilence?: () => void) => {
    try {
      // Clear previous data for a fresh start
      setTranscript('');
      setInterimTranscript('');
      setAmplitude(0);
      setErrorCount(0);
      
      // 1. Audio Visualizer Setup
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 128;
      source.connect(analyzer);
      analyzerRef.current = analyzer;
      
      const dataArray = new Uint8Array(analyzer.frequencyBinCount);
      dataArrayRef.current = dataArray;
      
      setIsRecording(true);
      setStatus('recording');
      setErrorCount(0);
      setTranscript('');
      setInterimTranscript('');
      
      const updateAmplitude = () => {
        if (!analyzer) return;
        analyzer.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < 30; i++) sum += dataArray[i];
        const amp = (sum / 30) / 255;
        setAmplitude(amp < 0.1 ? 0.1 : amp);
        animationFrameRef.current = requestAnimationFrame(updateAmplitude);
      };
      
      updateAmplitude();

      // 2. Speech Recognition Setup
      setupRecognition(onSilence);
    } catch (err) {
      console.error('Failed to start recording/recognition', err);
      setStatus('error');
      throw err;
    }
  };

  const setupRecognition = (onSilence?: () => void) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false; 
    recognition.interimResults = true;
    recognition.lang = getSpeechLocale(language);

    const resetSilenceTimer = (isFinalResult = false) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (onSilence) {
        // Predictive stop: if we just got a final block, we likely finished talking.
        // Use shorter timeout for final blocks (1.2s), longer for interim (2.2s).
        const timeout = isFinalResult ? 1200 : 2200;
        silenceTimerRef.current = window.setTimeout(() => {
          console.log(`Silence detected (${timeout}ms). Auto-confirming...`);
          onSilence();
        }, timeout);
      }
    };

    recognition.onstart = () => {
      setStatus('recording');
      setErrorCount(0); // Reset on every successful start
      console.log('Voice session started (Aggressive Loop)');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalBatch = '';
      let hasFinal = false;

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalBatch += event.results[i][0].transcript;
          hasFinal = true;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      resetSilenceTimer(hasFinal);

      if (finalBatch) {
        setTranscript(prev => {
          const newText = prev + finalBatch + ' ';
          return newText;
        });
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return; 
      
      console.warn('Speech recognition transient error:', event.error);
      if (event.error === 'network') {
        setStatus('connecting'); // Transient status
        setErrorCount(prev => prev + 1);
      } else if (event.error === 'aborted') {
        // Just let it restart in onend
      } else {
        // For other errors, we still try to resume but maybe notify more clearly
        console.error('Critical recognition error:', event.error);
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current && isRecording) {
        // Super aggressive restart
        // If it was a network error, wait a bit longer, otherwise restart immediately
        const delay = status === 'connecting' ? 1000 : 10;
        
        setTimeout(() => {
          if (recognitionRef.current && isRecording && errorCount < 50) { // Very high threshold for network retries
            try { 
              recognition.start(); 
              // Don't set status to recording here, onstart will do it
            } catch (e) {
              // Usually means it's already starting
            }
          } else if (errorCount >= 50) {
            setStatus('error');
            setIsRecording(false);
          }
        }, delay);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setStatus('idle');
    
    // Stop Audio
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Stop Recognition
    if (recognitionRef.current) {
      const recognition = recognitionRef.current;
      recognitionRef.current = null; // Prevent restart in onend
      recognition.stop();
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
  }, []);

  return { isRecording, startRecording, stopRecording, amplitude, transcript, interimTranscript, status };
}
