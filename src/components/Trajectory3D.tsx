import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Rotate3d, RefreshCw, Layers, Box, Play, Pause } from 'lucide-react';

interface Point3D {
  S: number;
  I: number;
  R: number;
  day: number;
}

interface Trajectory3DProps {
  points: Point3D[];
  totalPopulation: number;
}

export default function Trajectory3D({ points, totalPopulation }: Trajectory3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Ángulos de cámara (en radianes)
  const [yaw, setYaw] = useState<number>(-0.6);   // Rotación alrededor de Y
  const [pitch, setPitch] = useState<number>(0.4); // Rotación alrededor de X
  const [zoom, setZoom] = useState<number>(1.1);   // Nivel de zoom
  const [showSimplex, setShowSimplex] = useState<boolean>(true); // Mostrar plano S+I+R = N
  const [showBox, setShowBox] = useState<boolean>(true); // Mostrar caja delimitadora
  const [isRotatingAuto, setIsRotatingAuto] = useState<boolean>(false); // Autorrotación lenta

  // Control temporal y reproducción de la simulación
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(0);

  // Estado para arrastre del ratón
  const isDragging = useRef<boolean>(false);
  const previousMousePosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Normalizar los puntos al rango [0, 1]
  const normalizedPoints = useMemo(() => {
    if (!points || points.length === 0) return [];
    return points.map(pt => ({
      s: pt.S / totalPopulation,
      i: pt.I / totalPopulation,
      r: pt.R / totalPopulation,
      day: pt.day,
    }));
  }, [points, totalPopulation]);

  // Sincronizar el paso final al cargar nuevos puntos (comienza mostrando el final de la curva)
  useEffect(() => {
    if (points && points.length > 0) {
      setCurrentStep(points.length - 1);
      setIsPlaying(false);
    }
  }, [points]);

  // Efecto de temporizador para reproducir/animar paso a paso
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setCurrentStep(prev => {
        if (prev >= points.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 60); // 60ms por paso para avance fluido de la animación
    return () => clearInterval(interval);
  }, [isPlaying, points.length]);

  // Autorrotación lenta si está activa
  useEffect(() => {
    if (!isRotatingAuto) return;
    let animationId: number;
    const tick = () => {
      setYaw(prev => (prev + 0.005) % (Math.PI * 2));
      animationId = requestAnimationFrame(tick);
    };
    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [isRotatingAuto]);

  // Manejo de eventos de ratón
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDragging.current = true;
    setIsRotatingAuto(false); // Detener autorrotación al interactuar
    previousMousePosition.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - previousMousePosition.current.x;
    const deltaY = e.clientY - previousMousePosition.current.y;

    setYaw(prev => prev + deltaX * 0.01);
    setPitch(prev => Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, prev + deltaY * 0.01)));

    previousMousePosition.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUpOrLeave = () => {
    isDragging.current = false;
  };

  // Manejar cambio manual del slider
  const handleStepChange = (step: number) => {
    setIsPlaying(false); // Pausar reproducción si el usuario interactúa manualmente
    setCurrentStep(step);
  };

  const togglePlay = () => {
    if (currentStep >= points.length - 1) {
      setCurrentStep(0);
    }
    setIsPlaying(!isPlaying);
  };

  // Dibujar el espacio 3D en el Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ajustar el canvas al tamaño real del elemento de visualización (Retina ready)
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;
    const centerY = height / 2 + 10;
    const size = Math.min(width, height) * 0.4 * zoom; // Escala base de la caja 3D

    // Limpiar pantalla
    ctx.clearRect(0, 0, width, height);

    // Definir proyecciones 3D
    // El espacio SIR va de [0, 1] en cada eje
    // Mapeamos [0, 1] al cubo local de coordenadas [-0.5, 0.5]
    const project = (s: number, i: number, r: number) => {
      // Centrar en el origen [-0.5, 0.5]
      const cx = s - 0.5;
      const cy = i - 0.5;
      const cz = r - 0.5;

      // Escalar al tamaño del cubo
      const x3d = cx * size;
      const y3d = cy * size;
      const z3d = cz * size;

      // Rotación Yaw (alrededor de Y)
      const x1 = x3d * Math.cos(yaw) - z3d * Math.sin(yaw);
      const z1 = x3d * Math.sin(yaw) + z3d * Math.cos(yaw);

      // Rotación Pitch (alrededor de X)
      const y2 = y3d * Math.cos(pitch) - z1 * Math.sin(pitch);
      const z2 = y3d * Math.sin(pitch) + z1 * Math.cos(pitch);

      // Perspectiva simple
      const distance = size * 3;
      const scale = distance / (distance + z2);

      return {
        x: centerX + x1 * scale,
        y: centerY - y2 * scale, // Negativo porque Y de pantalla va hacia abajo
        depth: z2, // Para ordenamiento de dibujo si fuera necesario
      };
    };

    // Vértices de la caja del espacio unitario [0, 1]^3
    const vertices = [
      { s: 0, i: 0, r: 0 }, // 0
      { s: 1, i: 0, r: 0 }, // 1
      { s: 1, i: 1, r: 0 }, // 2
      { s: 0, i: 1, r: 0 }, // 3
      { s: 0, i: 0, r: 1 }, // 4
      { s: 1, i: 0, r: 1 }, // 5
      { s: 1, i: 1, r: 1 }, // 6
      { s: 0, i: 1, r: 1 }, // 7
    ];

    const pVertices = vertices.map(v => project(v.s, v.i, v.r));

    // Dibujar la rejilla de fondo de la caja (caras traseras para dar profundidad)
    if (showBox) {
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      // Conexiones de las caras
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0], // Cara trasera / delantera
        [4, 5], [5, 6], [6, 7], [7, 4], // Cara opuesta
        [0, 4], [1, 5], [2, 6], [3, 7], // Pilares de unión
      ];

      edges.forEach(([u, v]) => {
        ctx.beginPath();
        ctx.moveTo(pVertices[u].x, pVertices[u].y);
        ctx.lineTo(pVertices[v].x, pVertices[v].y);
        ctx.stroke();
      });

      ctx.setLineDash([]); // Restablecer estilo de línea
    }

    // Dibujar los ejes S, I, R desde el origen (0, 0, 0)
    // S-axis (Susceptibles): Azul/Celeste, va hacia (1, 0, 0)
    // I-axis (Infectados): Rojo/Rosa, va hacia (0, 1, 0) (eje vertical de la epidemia)
    // R-axis (Recuperados): Verde/Esmeralda, va hacia (0, 0, 1)
    const axes = [
      { color: '#38bdf8', label: 'Susceptibles (S)', to: { s: 1.1, i: 0, r: 0 }, origin: { s: 0, i: 0, r: 0 } },
      { color: '#f43f5e', label: 'Infectados (I)', to: { s: 0, i: 1.1, r: 0 }, origin: { s: 0, i: 0, r: 0 } },
      { color: '#10b981', label: 'Recuperados (R)', to: { s: 0, i: 0, r: 1.1 }, origin: { s: 0, i: 0, r: 0 } },
    ];

    axes.forEach(axis => {
      const pStart = project(axis.origin.s, axis.origin.i, axis.origin.r);
      const pEnd = project(axis.to.s, axis.to.i, axis.to.r);

      // Dibujar línea del eje
      ctx.strokeStyle = axis.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.stroke();

      // Flecha en la punta del eje
      const angle = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);
      ctx.fillStyle = axis.color;
      ctx.beginPath();
      ctx.moveTo(pEnd.x, pEnd.y);
      ctx.lineTo(pEnd.x - 8 * Math.cos(angle - Math.PI / 6), pEnd.y - 8 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(pEnd.x - 8 * Math.cos(angle + Math.PI / 6), pEnd.y - 8 * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();

      // Etiqueta del eje
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 11px Inter, sans-serif';
      // Desplazar la etiqueta un poco más allá de la punta
      ctx.fillText(axis.label, pEnd.x + 8 * Math.cos(angle), pEnd.y + 8 * Math.sin(angle));
    });

    // Dibujar el plano S + I + R = N (Plano de la población constante en el espacio SIR)
    // El plano interseca los tres ejes en s=1, i=1, r=1, formando una superficie triangular
    if (showSimplex) {
      const pS1 = project(1, 0, 0);
      const pI1 = project(0, 1, 0);
      const pR1 = project(0, 0, 1);

      // Dibujar el triángulo traslúcido de la superficie de estado
      ctx.fillStyle = 'rgba(99, 102, 241, 0.12)'; // Color índigo muy tenue
      ctx.beginPath();
      ctx.moveTo(pS1.x, pS1.y);
      ctx.lineTo(pI1.x, pI1.y);
      ctx.lineTo(pR1.x, pR1.y);
      ctx.closePath();
      ctx.fill();

      // Bordes del plano triangular (borde de la superficie de contagio)
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pS1.x, pS1.y);
      ctx.lineTo(pI1.x, pI1.y);
      ctx.lineTo(pR1.x, pR1.y);
      ctx.closePath();
      ctx.stroke();

      // Dibujar líneas de rejilla en el plano triangular
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)';
      ctx.lineWidth = 1;
      const subdivisions = 5;
      for (let k = 1; k < subdivisions; k++) {
        const t = k / subdivisions;
        // Líneas entre eje S y R
        const pSR_A = project(1 - t, 0, t);
        const pSR_B = project(0, 1 - t, t);
        ctx.beginPath();
        ctx.moveTo(pSR_A.x, pSR_A.y);
        ctx.lineTo(pSR_B.x, pSR_B.y);
        ctx.stroke();

        const pSI_A = project(t, 1 - t, 0);
        const pSI_B = project(t, 0, 1 - t);
        ctx.beginPath();
        ctx.moveTo(pSI_A.x, pSI_A.y);
        ctx.lineTo(pSI_B.x, pSI_B.y);
        ctx.stroke();
      }
    }

    // Dibujar la trayectoria del brote epidémico
    if (normalizedPoints.length > 1) {
      // 1. Dibujar la trayectoria completa de fondo (un poco más tenue para dar perspectiva de la línea total)
      ctx.beginPath();
      const pStartFull = project(normalizedPoints[0].s, normalizedPoints[0].i, normalizedPoints[0].r);
      ctx.moveTo(pStartFull.x, pStartFull.y);

      for (let i = 1; i < normalizedPoints.length; i++) {
        const pt = normalizedPoints[i];
        const p = project(pt.s, pt.i, pt.r);
        ctx.lineTo(p.x, p.y);
      }

      ctx.strokeStyle = 'rgba(245, 158, 11, 0.2)'; // Ámbar semi-transparente
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 2. Dibujar la porción activa de la trayectoria hasta el paso actual
      const boundStep = Math.min(currentStep, normalizedPoints.length - 1);
      if (boundStep > 0) {
        ctx.beginPath();
        ctx.moveTo(pStartFull.x, pStartFull.y);

        for (let i = 1; i <= boundStep; i++) {
          const pt = normalizedPoints[i];
          const p = project(pt.s, pt.i, pt.r);
          ctx.lineTo(p.x, p.y);
        }

        // Estilo de línea de trayectoria activa con un ligero brillo
        ctx.strokeStyle = '#f59e0b'; // Ámbar brillante
        ctx.lineWidth = 3.5;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 4;
        ctx.stroke();
        ctx.shadowBlur = 0; // Apagar brillo
      }

      // Dibujar puntos clave fijos de la trayectoria
      // Punto de inicio (Día 0)
      const pStart = project(normalizedPoints[0].s, normalizedPoints[0].i, normalizedPoints[0].r);
      ctx.fillStyle = '#38bdf8'; // Azul
      ctx.beginPath();
      ctx.arc(pStart.x, pStart.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Punto final
      const lastIdx = normalizedPoints.length - 1;
      const pEnd = project(normalizedPoints[lastIdx].s, normalizedPoints[lastIdx].i, normalizedPoints[lastIdx].r);
      ctx.fillStyle = '#10b981'; // Verde
      ctx.beginPath();
      ctx.arc(pEnd.x, pEnd.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Encontrar el pico histórico de infecciones
      let maxIVal = -1;
      let maxIIdx = 0;
      normalizedPoints.forEach((pt, idx) => {
        if (pt.i > maxIVal) {
          maxIVal = pt.i;
          maxIIdx = idx;
        }
      });

      const pPeak = project(normalizedPoints[maxIIdx].s, normalizedPoints[maxIIdx].i, normalizedPoints[maxIIdx].r);
      ctx.fillStyle = '#f43f5e'; // Rojo/Rosa
      ctx.beginPath();
      ctx.arc(pPeak.x, pPeak.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Pequeñas etiquetas flotantes para hitos históricos
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px monospace';
      ctx.fillText('Inicio', pStart.x + 8, pStart.y - 4);
      ctx.fillText(`Pico (Día ${Math.round(normalizedPoints[maxIIdx].day)})`, pPeak.x + 8, pPeak.y - 4);
      ctx.fillText('Final', pEnd.x + 8, pEnd.y - 4);

      // 3. Proyecciones y punto dinámico en tiempo real
      const activePt = normalizedPoints[boundStep];
      if (activePt) {
        const pActive = project(activePt.s, activePt.i, activePt.r);
        const pFloor = project(activePt.s, 0, activePt.r);
        const pSAxis = project(activePt.s, 0, 0);
        const pRAxis = project(0, 0, activePt.r);

        // Línea de proyección vertical (Infectados - Altura del brote)
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)'; // Faint rose
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(pActive.x, pActive.y);
        ctx.lineTo(pFloor.x, pFloor.y);
        ctx.stroke();

        // Línea en el suelo hacia el eje S (Susceptibles)
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)'; // Faint sky
        ctx.beginPath();
        ctx.moveTo(pFloor.x, pFloor.y);
        ctx.lineTo(pSAxis.x, pSAxis.y);
        ctx.stroke();

        // Línea en el suelo hacia el eje R (Recuperados)
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)'; // Faint emerald
        ctx.beginPath();
        ctx.moveTo(pFloor.x, pFloor.y);
        ctx.lineTo(pRAxis.x, pRAxis.y);
        ctx.stroke();
        ctx.setLineDash([]); // Resetear patrón

        // Dibujar el punto activo animado (Pulsante)
        const pulseRadius = 7.5 + Math.sin(Date.now() * 0.006) * 2;
        ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.beginPath();
        ctx.arc(pActive.x, pActive.y, pulseRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f59e0b'; // Core naranja
        ctx.beginPath();
        ctx.arc(pActive.x, pActive.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Pequeño panel flotante de datos del punto activo
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.lineWidth = 1;
        const tooltipW = 105;
        const tooltipH = 52;
        const tx = pActive.x + 12;
        const ty = pActive.y - 62;
        
        // Ajuste seguro de bordes
        const safeTx = Math.min(tx, width - tooltipW - 10);
        const safeTy = Math.max(ty, 10);

        ctx.beginPath();
        ctx.roundRect(safeTx, safeTy, tooltipW, tooltipH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(`Día: ${Math.round(activePt.day)}`, safeTx + 6, safeTy + 12);
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`S: ${(activePt.s * 100).toFixed(1)}%`, safeTx + 6, safeTy + 22);
        ctx.fillStyle = '#f43f5e';
        ctx.fillText(`I: ${(activePt.i * 100).toFixed(1)}%`, safeTx + 6, safeTy + 32);
        ctx.fillStyle = '#10b981';
        ctx.fillText(`R: ${(activePt.r * 100).toFixed(1)}%`, safeTx + 6, safeTy + 42);
      }
    }
  }, [normalizedPoints, yaw, pitch, zoom, showSimplex, showBox, currentStep]);

  // Restablecer vista inicial
  const handleReset = () => {
    setYaw(-0.6);
    setPitch(0.4);
    setZoom(1.1);
    setIsRotatingAuto(false);
  };

  return (
    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 flex flex-col h-[590px]" id="trajectory-3d-card">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-4">
        <div>
          <h3 className="font-bold text-base text-white flex items-center gap-2">
            <Rotate3d className="h-5 w-5 text-indigo-400" />
            Trayectoria Dinámica SIR en el Espacio 3D
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Arrastra el ratón sobre el gráfico para rotar. Usa los controles inferiores para animar y examinar la evolución temporal.
          </p>
        </div>

        {/* Botones de Control */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSimplex(!showSimplex)}
            className={`p-1.5 px-3 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
              showSimplex
                ? 'bg-indigo-600/15 border-indigo-500 text-indigo-300'
                : 'bg-slate-900/40 border-slate-700/60 text-slate-400 hover:bg-slate-800/40'
            }`}
            title="Mostrar / Ocultar la superficie del plano constante S+I+R = N"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Superficie</span>
          </button>

          <button
            type="button"
            onClick={() => setShowBox(!showBox)}
            className={`p-1.5 px-3 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
              showBox
                ? 'bg-indigo-600/15 border-indigo-500 text-indigo-300'
                : 'bg-slate-900/40 border-slate-700/60 text-slate-400 hover:bg-slate-800/40'
            }`}
            title="Mostrar / Ocultar la caja delimitadora"
          >
            <Box className="h-3.5 w-3.5" />
            <span>Caja</span>
          </button>

          <button
            type="button"
            onClick={() => setIsRotatingAuto(!isRotatingAuto)}
            className={`p-1.5 px-3 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
              isRotatingAuto
                ? 'bg-indigo-600/15 border-indigo-500 text-indigo-300'
                : 'bg-slate-900/40 border-slate-700/60 text-slate-400 hover:bg-slate-800/40'
            }`}
            title="Autorrotación continua lenta"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRotatingAuto ? 'animate-spin' : ''}`} />
            <span>Giro Auto</span>
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 px-3 rounded-lg text-xs font-medium bg-slate-900/50 border border-slate-700/60 text-slate-300 hover:bg-slate-800/50 transition-all"
            title="Restablecer vista a la orientación inicial"
          >
            Restablecer Vista
          </button>
        </div>
      </div>

      {/* Contenedor del Canvas */}
      <div className="flex-1 relative mt-4 bg-slate-950/40 rounded-xl overflow-hidden border border-slate-800/80 cursor-grab active:cursor-grabbing">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          className="w-full h-full block"
        />

        {/* Pequeña leyenda de información flotante */}
        <div className="absolute bottom-4 left-4 bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 text-[10px] space-y-1 text-slate-400 backdrop-blur-sm shadow-xl font-mono">
          <span className="font-bold text-slate-200 block border-b border-slate-800 pb-1 mb-1">Guía del Espacio de Estados</span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block"></span>
            <span>Eje X: Susceptibles (S)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
            <span>Eje Y: Infectados (I)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
            <span>Eje Z: Recuperados (R)</span>
          </div>
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/60 mt-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
            <span>Trayectoria del Brote</span>
          </div>
        </div>

        {/* Guía de la superficie de la epidemia */}
        <div className="absolute top-4 right-4 bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 text-[10px] text-slate-400 backdrop-blur-sm shadow-xl max-w-[200px] leading-relaxed">
          <span className="font-bold text-slate-200 block border-b border-slate-800 pb-1 mb-1">Superficie de la Epidemia</span>
          Debido a que la población total es constante (<span className="font-mono text-indigo-400">S + I + R = N</span>), la trayectoria está confinada al plano triangular visible. Esta superficie representa todos los estados posibles de la población.
        </div>
      </div>

      {/* Barra de Reproducción Temporal */}
      <div className="mt-4 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col md:flex-row items-center gap-4">
        {/* Play / Pause / Reset buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className={`p-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/20'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/20'
            }`}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>{isPlaying ? 'Pausar' : 'Reproducir'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleStepChange(0)}
            className="p-2 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 text-xs transition-all flex items-center justify-center"
            title="Ir al inicio (Día 0)"
          >
            Reiniciar (Día 0)
          </button>
        </div>

        {/* Timeline Slider */}
        <div className="flex-1 w-full flex items-center gap-3">
          <span className="text-[10px] font-mono text-slate-500">Día 0</span>
          <input
            type="range"
            min="0"
            max={points.length > 0 ? points.length - 1 : 0}
            value={currentStep}
            onChange={(e) => handleStepChange(parseInt(e.target.value))}
            className="flex-1 h-1.5 accent-indigo-500 bg-slate-950 rounded-lg cursor-pointer transition-all"
          />
          <span className="text-[11px] font-mono font-bold text-indigo-400 shrink-0">
            Día {Math.round(points[currentStep]?.day || 0)} / {Math.round(points[points.length - 1]?.day || 0)}
          </span>
        </div>

        {/* Datos en tiempo real de la reproducción */}
        {points[currentStep] && (
          <div className="hidden lg:flex items-center gap-4 px-3 border-l border-slate-800 py-1 text-[10.5px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400"></span>
              <span className="text-slate-400">S:</span>
              <span className="text-sky-300 font-bold">{((points[currentStep].S / totalPopulation) * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              <span className="text-slate-400">I:</span>
              <span className="text-rose-400 font-bold">{((points[currentStep].I / totalPopulation) * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-slate-400">R:</span>
              <span className="text-emerald-400 font-bold">{((points[currentStep].R / totalPopulation) * 100).toFixed(1)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
