import { useRef, useEffect } from 'react';

interface VoiceVisualizerProps {
  amplitude: number;
}

export function VoiceVisualizer({ amplitude }: VoiceVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);
      phaseRef.current += 0.05;
      
      const centerY = height / 2;
      
      // Draw 3 layers of waves as in original app.js
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.lineWidth = 2.5 - (j * 0.5);
        ctx.strokeStyle = j === 0 ? '#3b82f6' : (j === 1 ? 'rgba(59, 130, 246, 0.5)' : 'rgba(59, 130, 246, 0.2)');
        
        for (let x = 0; x < width; x++) {
          const normalizedX = x / width;
          const edgeFade = Math.sin(normalizedX * Math.PI);
          const freq = 0.05 + (j * 0.02);
          const y = centerY + Math.sin(x * freq + phaseRef.current + j) * (height * 0.4 * amplitude * edgeFade);
          
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [amplitude]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-12 bg-transparent"
      width={600}
      height={80}
    />
  );
}
