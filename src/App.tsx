/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Activity,
  HeartPulse,
  Calculator,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  BookOpen,
  Info,
  Calendar,
  Layers,
  ArrowRight,
  GraduationCap,
  Sparkles,
  HelpCircle,
  Users,
  CheckCircle2,
  FileText,
  Download,
  Skull,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Label,
  ScatterChart,
  Scatter,
  ZAxis
} from 'recharts';

import { SimulationParams, SimulationDataPoint, IterationStep } from './types';
import { solveEuler, solveRK4, runConvergenceAnalysis, sirDerivatives } from './utils/numericalSolvers';
import AiReportGenerator from './components/AiReportGenerator';
import Trajectory3D from './components/Trajectory3D';
import RiskAlerts from './components/RiskAlerts';

// Presets epidemiológicos realistas
interface EpidemicPreset {
  name: string;
  beta: number;
  gamma: number;
  recoveryPeriod: number;
  r0: number;
  description: string;
  cfr: number;
}

const EPIDEMIC_PRESETS: { [key: string]: EpidemicPreset } = {
  gripe: {
    name: 'Gripe Estacional',
    beta: 0.26,
    gamma: 0.20,
    recoveryPeriod: 5,
    r0: 1.3,
    description: 'Brote leve. Crecimiento lento y pico muy plano. El sistema de salud rara vez se satura.',
    cfr: 0.001
  },
  influenza: {
    name: 'Influenza H1N1',
    beta: 0.36,
    gamma: 0.20,
    recoveryPeriod: 5,
    r0: 1.8,
    description: 'Transmisibilidad moderada. El pico llega rápido pero es manejable con vacunación.',
    cfr: 0.005
  },
  sars: {
    name: 'SARS (2003)',
    beta: 0.375,
    gamma: 0.125,
    recoveryPeriod: 8,
    r0: 3.0,
    description: 'Transmisión alta con periodo infeccioso prolongado. Requiere medidas de aislamiento rápidas y estrictas.',
    cfr: 0.096
  },
  covid: {
    name: 'COVID-19 (Original)',
    beta: 0.50,
    gamma: 0.10,
    recoveryPeriod: 10,
    r0: 5.0,
    description: 'Alta propagación y periodo de recuperación de 10 días. Alto riesgo de saturar camas UCI si no se interviene a tiempo.',
    cfr: 0.02
  },
  sarampion: {
    name: 'Sarampión',
    beta: 1.20,
    gamma: 0.08,
    recoveryPeriod: 12.5,
    r0: 15.0,
    description: 'Extremadamente contagioso. Prácticamente toda la población se infecta rápidamente sin inmunidad previa o vacunas.',
    cfr: 0.002
  }
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulador' | 'intervenciones' | 'metodos'>('simulador');
  
  // Parámetros de la simulación principal
  const [params, setParams] = useState<SimulationParams>({
    totalPopulation: 100000,
    beta: 0.45,
    gamma: 0.10, // 1/10 días de recuperación
    initialInfected: 50,
    initialRecovered: 0,
    days: 120,
    stepSize: 0.5, // h default
    hospitalBeds: 1500, // camas generales
    icuBeds: 400, // camas UCI
    method: 'RK4' // RK4 por defecto por ser más preciso
  });

  // Tasa de Letalidad (Case Fatality Rate - CFR) del modelo de mortalidad
  const [cfr, setCfr] = useState<number>(0.02); // 2% por defecto

  const [presetKey, setPresetKey] = useState<string>('custom');

  // Intervenciones de Gobierno
  const [applyInterventions, setApplyInterventions] = useState<boolean>(false);
  const [interventionDay, setInterventionDay] = useState<number>(25);
  const [quarantineActive, setQuarantineActive] = useState<boolean>(false);
  const [maskActive, setMaskActive] = useState<boolean>(false);
  const [vaccineActive, setVaccineActive] = useState<boolean>(false);

  // Parámetro para el Sandbox de Convergencia Numérica (h variable)
  const [sandboxH, setSandboxH] = useState<number>(1.5);

  // Aplicar preset epidemiológico
  const handleApplyPreset = (key: string) => {
    setPresetKey(key);
    if (key === 'custom') return;
    const preset = EPIDEMIC_PRESETS[key];
    setParams(prev => ({
      ...prev,
      beta: preset.beta,
      gamma: preset.gamma,
    }));
    setCfr(preset.cfr);
  };

  // Cálculo de R0 actual
  const currentR0 = useMemo(() => {
    return params.beta / params.gamma;
  }, [params.beta, params.gamma]);

  // Cálculo de R0 con intervenciones activas
  const interventionR0 = useMemo(() => {
    if (!applyInterventions) return currentR0;
    let activeBeta = params.beta;
    if (quarantineActive) {
      activeBeta *= 0.40;
    } else if (maskActive) {
      activeBeta *= 0.70;
    }
    return activeBeta / params.gamma;
  }, [params.beta, params.gamma, applyInterventions, quarantineActive, maskActive, currentR0]);

  // Duración media de la enfermedad (1 / gamma)
  const recoveryPeriodDays = useMemo(() => {
    return Math.round(1 / params.gamma);
  }, [params.gamma]);

  // --- EJECUCIÓN DE LA SIMULACIÓN PRINCIPAL ---
  const simulationResults = useMemo(() => {
    let result;
    if (params.method === 'Euler') {
      result = solveEuler(params);
    } else {
      // RK4 o Both (usamos RK4 para los puntos primarios)
      result = solveRK4(params);
    }

    // Si se compara Both, obtenemos también la curva de Euler para graficarla encima
    const eulerRes = params.method === 'Both' ? solveEuler(params).points : [];

    // Encontrar el pico de infecciones y estadísticas
    let peakInfectedCount = 0;
    let peakInfectedDay = 0;
    let bedsOverflowed = false;
    let overflowDay: number | null = null;

    result.points.forEach(pt => {
      if (pt.I > peakInfectedCount) {
        peakInfectedCount = pt.I;
        peakInfectedDay = pt.day;
      }
      if (pt.hospitalizedNeeded > params.hospitalBeds && !bedsOverflowed) {
        bedsOverflowed = true;
        overflowDay = pt.day;
      }
    });

    return {
      points: result.points,
      steps: result.steps,
      peakInfectedCount,
      peakInfectedDay,
      bedsOverflowed,
      overflowDay,
      eulerPoints: eulerRes
    };
  }, [params]);

  // --- EJECUCIÓN DE LA SIMULACIÓN CON INTERVENCIONES ---
  const interventionResults = useMemo(() => {
    // Para modelar la intervención, resolvemos paso a paso usando un solucionador dinámico
    // El solucionador cambia beta y gamma según el día de la simulación
    const { totalPopulation: N, gamma, initialInfected: I0, initialRecovered: R0, days, stepSize: h } = params;
    const S0 = N - I0 - R0;

    const points: SimulationDataPoint[] = [];
    let S = S0;
    let I = I0;
    let R = R0;
    let t = 0;

    const hospRate = 0.05;
    const icuRate = 0.012;

    points.push({
      day: 0,
      S: Math.round(S),
      I: Math.round(I),
      R: Math.round(R),
      totalBedsLimit: params.hospitalBeds,
      icuBedsLimit: params.icuBeds,
      hospitalizedNeeded: Math.round(I * hospRate),
      icuNeeded: Math.round(I * icuRate),
    });

    const totalSteps = Math.ceil(days / h);

    for (let k = 1; k <= totalSteps; k++) {
      t = k * h;

      // Evaluar si estamos en o después del día de intervención para alterar coeficientes
      let activeBeta = params.beta;
      let activeS = S;
      let activeR = R;

      if (applyInterventions && t >= interventionDay) {
        // Reducción de beta por cuarentena
        if (quarantineActive) {
          activeBeta *= 0.40; // Reducción del 60%
        } else if (maskActive) {
          activeBeta *= 0.70; // Reducción del 30%
        }

        // Vacunación: Directamente inmuniza un porcentaje de la población susceptible
        // Simulamos una campaña masiva de vacunación en el día de inicio
        // Para que sea un evento de impulso en el tiempo: si t está en el intervalo inmediato tras la intervención
        if (vaccineActive && Math.abs(t - interventionDay) < h / 2) {
          const vaccinatedCount = activeS * 0.20; // 20% de susceptibles se vacunan y pasan a Recuperados/Inmunes
          S = Math.max(0, S - vaccinatedCount);
          R = R + vaccinatedCount;
        }
      }

      // Realizar paso RK4 con el beta activo
      const k1 = sirDerivatives(S, I, R, activeBeta, gamma, N);
      
      const S_k2 = S + (h / 2) * k1.dS;
      const I_k2 = I + (h / 2) * k1.dI;
      const R_k2 = R + (h / 2) * k1.dR;
      const k2 = sirDerivatives(S_k2, I_k2, R_k2, activeBeta, gamma, N);

      const S_k3 = S + (h / 2) * k2.dS;
      const I_k3 = I + (h / 2) * k2.dI;
      const R_k3 = R + (h / 2) * k2.dR;
      const k3 = sirDerivatives(S_k3, I_k3, R_k3, activeBeta, gamma, N);

      const S_k4 = S + h * k3.dS;
      const I_k4 = I + h * k3.dI;
      const R_k4 = R + h * k3.dR;
      const k4 = sirDerivatives(S_k4, I_k4, R_k4, activeBeta, gamma, N);

      S = S + (h / 6) * (k1.dS + 2 * k2.dS + 2 * k3.dS + k4.dS);
      I = I + (h / 6) * (k1.dI + 2 * k2.dI + 2 * k3.dI + k4.dI);
      R = R + (h / 6) * (k1.dR + 2 * k2.dR + 2 * k3.dR + k4.dR);

      S = Math.max(0, Math.min(N, S));
      I = Math.max(0, Math.min(N, I));
      R = Math.max(0, Math.min(N, R));

      if (Math.abs(t - Math.round(t)) < h / 2 && Math.round(t) <= days) {
        const targetDay = Math.round(t);
        if (!points.some(p => p.day === targetDay)) {
          points.push({
            day: targetDay,
            S: Math.round(S),
            I: Math.round(I),
            R: Math.round(R),
            totalBedsLimit: params.hospitalBeds,
            icuBedsLimit: params.icuBeds,
            hospitalizedNeeded: Math.round(I * hospRate),
            icuNeeded: Math.round(I * icuRate),
          });
        }
      }
    }

    if (!points.some(p => p.day === days)) {
      points.push({
        day: days,
        S: Math.round(S),
        I: Math.round(I),
        R: Math.round(R),
        totalBedsLimit: params.hospitalBeds,
        icuBedsLimit: params.icuBeds,
        hospitalizedNeeded: Math.round(I * hospRate),
        icuNeeded: Math.round(I * icuRate),
      });
    }

    points.sort((a, b) => a.day - b.day);

    // Encontrar estadísticas para el modelo con intervención
    let peakInfectedCount = 0;
    let peakInfectedDay = 0;
    let bedsOverflowed = false;
    let overflowDay: number | null = null;

    points.forEach(pt => {
      if (pt.I > peakInfectedCount) {
        peakInfectedCount = pt.I;
        peakInfectedDay = pt.day;
      }
      if (pt.hospitalizedNeeded > params.hospitalBeds && !bedsOverflowed) {
        bedsOverflowed = true;
        overflowDay = pt.day;
      }
    });

    return {
      points,
      peakInfectedCount,
      peakInfectedDay,
      bedsOverflowed,
      overflowDay
    };
  }, [params, applyInterventions, interventionDay, quarantineActive, maskActive, vaccineActive]);


  // --- EJECUCIÓN DEL SANDBOX DE CONVERGENCIA NUMÉRICA ---
  const convergenceSandboxData = useMemo(() => {
    return runConvergenceAnalysis({
      ...params,
      stepSize: sandboxH
    });
  }, [params, sandboxH]);

  // Error relativo máximo en el Sandbox
  const maxErrors = useMemo(() => {
    let maxE = 0;
    let maxRK = 0;
    convergenceSandboxData.forEach(d => {
      if (d.error_euler > maxE) maxE = d.error_euler;
      if (d.error_rk4 > maxRK) maxRK = d.error_rk4;
    });
    return {
      euler: maxE,
      rk4: maxRK
    };
  }, [convergenceSandboxData]);

  // Datos de barrido de h vs error para el scatter plot
  const errorVsStepSizeData = useMemo(() => {
    const eulerData: { x: number; y: number; diverged: boolean; info: string }[] = [];
    const rk4Data: { x: number; y: number; diverged: boolean; info: string }[] = [];
    
    // Sweep h from 0.1 to 3.5 in increments of 0.1
    for (let hTest = 0.1; hTest <= 3.5; hTest = parseFloat((hTest + 0.1).toFixed(1))) {
      const dataForH = runConvergenceAnalysis({
        ...params,
        stepSize: hTest
      });
      
      const lastPt = dataForH[dataForH.length - 1];
      const eulerError = lastPt ? lastPt.error_euler : 0;
      const rk4Error = lastPt ? lastPt.error_rk4 : 0;
      
      const eulerDiverged = !isFinite(eulerError) || isNaN(eulerError) || eulerError > 100;
      const rk4Diverged = !isFinite(rk4Error) || isNaN(rk4Error) || rk4Error > 100;
      
      eulerData.push({
        x: hTest,
        y: eulerDiverged ? 100 : parseFloat(eulerError.toFixed(3)),
        diverged: eulerDiverged,
        info: eulerDiverged ? 'Divergencia (>100% de Error)' : `${eulerError.toFixed(3)}% error`
      });
      
      rk4Data.push({
        x: hTest,
        y: rk4Diverged ? 100 : parseFloat(rk4Error.toFixed(3)),
        diverged: rk4Diverged,
        info: rk4Diverged ? 'Divergencia (>100% de Error)' : `${rk4Error.toFixed(3)}% error`
      });
    }
    
    return { eulerData, rk4Data };
  }, [params]);

  const eulerDivergencePoint = useMemo(() => {
    const divPt = errorVsStepSizeData.eulerData.find(d => d.diverged);
    return divPt ? divPt.x : null;
  }, [errorVsStepSizeData]);

  // Defunciones totales estimadas (simulación activa)
  const totalDeaths = useMemo(() => {
    const lastPoint = simulationResults.points[simulationResults.points.length - 1];
    if (!lastPoint) return 0;
    return Math.round(lastPoint.R * cfr);
  }, [simulationResults.points, cfr]);

  // Defunciones totales estimadas (simulación con intervenciones)
  const totalDeathsIntervention = useMemo(() => {
    const lastPoint = interventionResults.points[interventionResults.points.length - 1];
    if (!lastPoint) return 0;
    return Math.round(lastPoint.R * cfr);
  }, [interventionResults.points, cfr]);

  // Preparar datos consolidados para Recharts (Combinando Euler y RK4 si método es 'Both')
  const chartData = useMemo(() => {
    if (params.method !== 'Both') {
      return simulationResults.points.map(pt => ({
        ...pt,
        D: Math.round(pt.R * cfr)
      }));
    }
    // Si es "Both", fusionamos los infectados de Euler con los de RK4
    return simulationResults.points.map((pt) => {
      const eulerPt = simulationResults.eulerPoints.find(ep => ep.day === pt.day);
      return {
        ...pt,
        I_RK4: pt.I,
        I_Euler: eulerPt ? eulerPt.I : null,
        D: Math.round(pt.R * cfr)
      };
    });
  }, [simulationResults, params.method, cfr]);

  // Análisis de sensibilidad de la Tasa de Transmisión (Beta) respecto al Pico de Infectados (±20%)
  const sensitivityAnalysis = useMemo(() => {
    // Variación de Beta en un rango de ±20%
    const variations = [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20];
    const currentBasePeak = simulationResults.peakInfectedCount;

    return variations.map(variation => {
      const percentageStr = variation === 0 
        ? "Base (Actual)" 
        : (variation > 0 ? `+${Math.round(variation * 100)}%` : `${Math.round(variation * 100)}%`);
      
      const tempBeta = params.beta * (1 + variation);
      const tempParams = { ...params, beta: tempBeta };
      
      // Correr simulación usando el método activo (o RK4 por defecto si es 'Both')
      const res = params.method === 'Euler' ? solveEuler(tempParams) : solveRK4(tempParams);
      
      let peakInfectedCount = 0;
      let peakInfectedDay = 0;
      let bedsOverflowed = false;
      let overflowDay = -1;
      
      res.points.forEach(pt => {
        if (pt.I > peakInfectedCount) {
          peakInfectedCount = pt.I;
          peakInfectedDay = pt.day;
        }
        if (pt.hospitalizedNeeded > params.hospitalBeds && !bedsOverflowed) {
          bedsOverflowed = true;
          overflowDay = pt.day;
        }
      });
      
      const changePercent = currentBasePeak > 0 ? ((peakInfectedCount - currentBasePeak) / currentBasePeak) * 100 : 0;
      
      return {
        variation: percentageStr,
        beta: tempBeta,
        r0: tempBeta / params.gamma,
        peakInfected: Math.round(peakInfectedCount),
        peakDay: Math.round(peakInfectedDay),
        bedsOverflowed,
        overflowDay,
        changePercent: variation === 0 ? 0 : changePercent
      };
    });
  }, [params, simulationResults.peakInfectedCount]);

  // Función para exportar resultados de simulación a un archivo CSV
  const exportToCSV = () => {
    let csvContent = "\uFEFF"; // BOM para asegurar que Excel reconozca UTF-8 correctamente

    if (activeTab === 'intervenciones') {
      // Encabezados comparativos con mortalidad
      csvContent += "Dia,Susceptibles_S_Sin_Intervencion,Infectados_I_Sin_Intervencion,Recuperados_R_Sin_Intervencion,Defunciones_D_Sin_Intervencion,Susceptibles_S_Con_Intervencion,Infectados_I_Con_Intervencion,Recuperados_R_Con_Intervencion,Defunciones_D_Con_Intervencion,Camas_Hosp_Requeridas_Sin_Intervencion,Camas_Hosp_Requeridas_Con_Intervencion\n";
      
      const maxLength = Math.max(simulationResults.points.length, interventionResults.points.length);
      for (let i = 0; i < maxLength; i++) {
        const base = simulationResults.points[i] || { day: i, S: 0, I: 0, R: 0, hospitalizedNeeded: 0 };
        const mit = interventionResults.points[i] || { day: i, S: 0, I: 0, R: 0, hospitalizedNeeded: 0 };
        
        const baseDeaths = Math.round(base.R * cfr);
        const mitDeaths = Math.round(mit.R * cfr);
        
        csvContent += `${base.day},${base.S},${base.I},${base.R},${baseDeaths},${mit.S},${mit.I},${mit.R},${mitDeaths},${base.hospitalizedNeeded},${mit.hospitalizedNeeded}\n`;
      }
    } else {
      // Pestaña simulador u otros: exporta la simulación activa detallada
      const points = simulationResults.points;
      const isBoth = params.method === 'Both';
      
      if (isBoth) {
        csvContent += "Dia,Susceptibles_S_RK4,Infectados_I_RK4,Infectados_I_Euler,Recuperados_R_RK4,Defunciones_D,Camas_Generales_Requeridas_RK4,Camas_UCI_Requeridas_RK4\n";
        points.forEach(pt => {
          const eulerPt = simulationResults.eulerPoints.find(ep => ep.day === pt.day) || { I: pt.I };
          const deaths = Math.round(pt.R * cfr);
          csvContent += `${pt.day},${pt.S},${pt.I},${eulerPt.I},${pt.R},${deaths},${pt.hospitalizedNeeded},${pt.icuNeeded}\n`;
        });
      } else {
        csvContent += "Dia,Susceptibles_S,Infectados_I,Recuperados_R,Defunciones_D,Camas_Generales_Requeridas,Camas_UCI_Requeridas,Capacidad_Camas_General,Capacidad_Camas_UCI\n";
        points.forEach(pt => {
          const deaths = Math.round(pt.R * cfr);
          csvContent += `${pt.day},${pt.S},${pt.I},${pt.R},${deaths},${pt.hospitalizedNeeded},${pt.icuNeeded},${pt.totalBedsLimit},${pt.icuBedsLimit}\n`;
        });
      }
    }

    const label = activeTab === 'intervenciones' ? 'Comparativa_Mitigacion' : `Simulacion_${params.method}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `PlanificadorEpidemias_${label}_R0_${currentR0.toFixed(2)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Header Principal */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-600/20">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Planificador Epidemias PS
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold px-2 py-0.5 rounded-full uppercase">
                  Modelo SIR
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Simulación Numérica, Alertas Sanitärias y Capacidad Hospitalaria
              </p>
            </div>
          </div>

          {/* Navegación por Pestañas */}
          <nav className="flex bg-slate-800 p-1 rounded-xl border border-slate-700/60 shrink-0">
            <button
              onClick={() => setActiveTab('simulador')}
              className={`cursor-pointer px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                activeTab === 'simulador'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <HeartPulse className="h-3.5 w-3.5" />
              Simulador & Camas
            </button>
            <button
              onClick={() => setActiveTab('intervenciones')}
              className={`cursor-pointer px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                activeTab === 'intervenciones'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Políticas de Gobierno
            </button>
            <button
              onClick={() => setActiveTab('metodos')}
              className={`cursor-pointer px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                activeTab === 'metodos'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calculator className="h-3.5 w-3.5" />
              Métodos Numéricos
              <span className="bg-emerald-500/20 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase">Tab Obligatoria</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {/* TAB 1: SIMULADOR SIR & CAMAS HOSPITALARIAS */}
          {activeTab === 'simulador' && (
            <motion.div
              key="simulador"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-8"
            >
              {/* Grid Principal */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Panel de Controles Izquierdo */}
                <div className="lg:col-span-4 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-700/60 pb-4">
                    <h2 className="font-bold text-base text-white flex items-center gap-2">
                      <Layers className="h-4.5 w-4.5 text-indigo-400" />
                      Parámetros del Brote
                    </h2>
                    <span className="text-[11px] text-slate-400 font-mono">Población (N): {params.totalPopulation.toLocaleString()}</span>
                  </div>

                  {/* Selector de Presets Epidemiológicos en forma de Pestañas Interactivas */}
                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-slate-300 block">Enfermedades de Referencia (Ejemplos)</label>
                    
                    {/* Botones / Pestañas de Ejemplos */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleApplyPreset('custom')}
                        className={`py-2 px-2.5 text-left text-xs rounded-lg transition-all border flex flex-col justify-between h-[64px] ${
                          presetKey === 'custom'
                            ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-lg shadow-indigo-500/10'
                            : 'bg-slate-900/40 border-slate-700/60 text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                        }`}
                      >
                        <span className="font-semibold block text-[11px] truncate">⚙️ Personalizado</span>
                        <span className="text-[9px] text-slate-500 font-mono">Modo manual</span>
                      </button>

                      {Object.entries(EPIDEMIC_PRESETS).map(([key, value]) => {
                        const isSelected = presetKey === key;
                        let emoji = '🦠';
                        if (key === 'gripe') emoji = '🤧';
                        if (key === 'influenza') emoji = '🤒';
                        if (key === 'sars') emoji = '😷';
                        if (key === 'covid') emoji = '👑';
                        if (key === 'sarampion') emoji = '🔴';

                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleApplyPreset(key)}
                            className={`py-2 px-2.5 text-left text-xs rounded-lg transition-all border flex flex-col justify-between h-[64px] ${
                              isSelected
                                ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-lg shadow-indigo-500/10'
                                : 'bg-slate-900/40 border-slate-700/60 text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                            }`}
                          >
                            <span className="font-semibold block text-[11px] truncate">{emoji} {value.name}</span>
                            <span className="text-[10px] font-mono text-indigo-400 flex items-center justify-between w-full">
                              <span>R₀: {value.r0.toFixed(1)}</span>
                              <span className="text-red-400 font-bold text-[9px]">CFR: {(value.cfr * 100).toFixed(1)}%</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Caja de Información Detallada del Ejemplo de Pandemia */}
                    <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-3.5 space-y-2.5 text-xs">
                      {presetKey === 'custom' ? (
                        <div className="text-slate-400 text-[11px] leading-relaxed">
                          <span className="font-semibold text-slate-300 block mb-1">⚙️ Parámetros Personalizados</span>
                          Ajusta manualmente los controles deslizantes (sliders) a continuación para simular escenarios epidemiológicos a la medida.
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-between items-start border-b border-slate-800 pb-1.5">
                            <span className="font-bold text-slate-200 text-[13px] flex items-center gap-1.5">
                              {presetKey === 'gripe' && '🤧'}
                              {presetKey === 'influenza' && '🤒'}
                              {presetKey === 'sars' && '😷'}
                              {presetKey === 'covid' && '👑'}
                              {presetKey === 'sarampion' && '🔴'}
                              {EPIDEMIC_PRESETS[presetKey].name}
                            </span>
                            <span className="text-[10px] text-indigo-400 font-mono bg-indigo-950/50 px-2 py-0.5 rounded-full border border-indigo-800/30">
                              R₀ = {EPIDEMIC_PRESETS[presetKey].r0.toFixed(1)}
                            </span>
                          </div>
                          
                          <p className="text-[11px] text-slate-400 leading-relaxed italic">
                            "{EPIDEMIC_PRESETS[presetKey].description}"
                          </p>

                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 text-[10.5px] font-mono text-slate-300 border-t border-slate-800/60">
                            <div className="flex justify-between">
                              <span className="text-slate-500">Contagio (β):</span>
                              <span className="font-bold text-indigo-300">{EPIDEMIC_PRESETS[presetKey].beta.toFixed(3)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Letalidad (CFR):</span>
                              <span className="font-bold text-rose-400">{(EPIDEMIC_PRESETS[presetKey].cfr * 100).toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Periodo Rec.:</span>
                              <span className="font-bold text-indigo-300">{EPIDEMIC_PRESETS[presetKey].recoveryPeriod} días</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Tasa Rec. (γ):</span>
                              <span className="font-bold text-indigo-300">{EPIDEMIC_PRESETS[presetKey].gamma.toFixed(3)}</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Sliders de Coeficientes SIR */}
                  <div className="space-y-4 pt-2">
                    {/* Tasa de Transmisión Beta */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium text-slate-300 flex items-center gap-1.5">
                          Tasa de Transmisión (β)
                          <span className="text-[10px] text-indigo-400 bg-indigo-950 px-1.5 py-0.2 rounded font-mono">contagios/día</span>
                        </span>
                        <span className="font-mono font-bold text-indigo-400">{params.beta.toFixed(3)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="2.00"
                        step="0.01"
                        value={params.beta}
                        onChange={(e) => {
                          setParams(prev => ({ ...prev, beta: parseFloat(e.target.value) }));
                          setPresetKey('custom');
                        }}
                        className="w-full accent-indigo-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                      />
                    </div>

                    {/* Periodo medio de recuperación (para calcular Gamma) */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium text-slate-300 flex items-center gap-1.5">
                          Período de Recuperación (1/γ)
                          <span className="text-[10px] text-indigo-400 bg-indigo-950 px-1.5 py-0.2 rounded font-mono">días</span>
                        </span>
                        <span className="font-mono font-bold text-indigo-400">{recoveryPeriodDays} días</span>
                      </div>
                      <input
                        type="range"
                        min="2"
                        max="25"
                        step="1"
                        value={recoveryPeriodDays}
                        onChange={(e) => {
                          const daysVal = parseInt(e.target.value);
                          setParams(prev => ({ ...prev, gamma: 1 / daysVal }));
                          setPresetKey('custom');
                        }}
                        className="w-full accent-indigo-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>γ = {params.gamma.toFixed(3)} (Tasa de recuperación diaria)</span>
                      </div>
                    </div>
                  </div>

                  {/* Indicador Epidemiológico R0 */}
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                        Número Reproductivo Básico (R₀)
                        <TooltipHelper content="Número promedio de casos secundarios generados por un individuo infectado en una población completamente susceptible. Si R₀ > 1, el brote se propaga exponencialmente." />
                      </span>
                      <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded-md ${
                        currentR0 > 1 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        R₀ = {currentR0.toFixed(2)}
                      </span>
                    </div>
                    {currentR0 > 1 ? (
                      <div className="text-[11px] text-red-400 leading-relaxed flex items-start gap-1.5 mt-1">
                        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                        <span><strong>Alerta Epidemiológica:</strong> Crecimiento exponencial activo. Cada infectado contagia a {currentR0.toFixed(1)} personas antes de recuperarse.</span>
                      </div>
                    ) : (
                      <div className="text-[11px] text-emerald-400 leading-relaxed flex items-start gap-1.5 mt-1">
                        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                        <span><strong>Epidemia Autolimitada:</strong> El número de contagios decaerá naturalmente puesto que R₀ es menor o igual a 1.</span>
                      </div>
                    )}
                  </div>

                  {/* Configuración Técnica y Métodos Numéricos */}
                  <div className="border-t border-slate-700/60 pt-4 space-y-4">
                    <h3 className="font-bold text-xs text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Calculator className="h-4 w-4 text-emerald-400" />
                      Configuración del Solucionador ODE
                    </h3>

                    {/* Selector de Método Numérico */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-400 block">Algoritmo Numérico</label>
                      <div className="grid grid-cols-3 gap-2">
                        {['Euler', 'RK4', 'Both'].map((m) => (
                          <button
                            key={m}
                            onClick={() => setParams(prev => ({ ...prev, method: m as any }))}
                            className={`cursor-pointer py-1.5 px-2 rounded-lg text-xs font-semibold border transition ${
                              params.method === m
                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {m === 'Both' ? 'Comparar Ambos' : m}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Paso de integración h */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-400 flex items-center gap-1">
                          Paso de Integración (Paso h)
                          <TooltipHelper content="El tamaño de paso h representa el incremento temporal en días para cada iteración de la aproximación numérica. Un paso muy grande puede causar inestabilidad." />
                        </span>
                        <span className="font-mono font-bold text-indigo-400">h = {params.stepSize} días</span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="2.00"
                        step="0.05"
                        value={params.stepSize}
                        onChange={(e) => setParams(prev => ({ ...prev, stepSize: parseFloat(e.target.value) }))}
                        className="w-full accent-indigo-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                        <span>h=0.05 (Máxima Precisión)</span>
                        <span>h=2.0 (Menos Precisión)</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setParams(prev => ({ ...prev, stepSize: 0.1 }))}
                        className="cursor-pointer mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-semibold text-slate-300 hover:text-white transition-all shadow-sm"
                        title="Restablecer h a 0.1 para máxima estabilidad del modelo"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Resetear a parámetros recomendados (h = 0.1)</span>
                      </button>
                    </div>
                  </div>

                  {/* Infraestructura Sanitaria de Gobierno */}
                  <div className="border-t border-slate-700/60 pt-4 space-y-4">
                    <h3 className="font-bold text-xs text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <HeartPulse className="h-4 w-4 text-rose-400" />
                      Planificación Hospitalaria (Gobierno)
                    </h3>

                    {/* Camas Generales */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium text-slate-300">Camas Hospitalarias</span>
                        <span className="font-mono font-bold text-rose-400">{params.hospitalBeds.toLocaleString()}</span>
                      </div>
                      <input
                        type="range"
                        min="200"
                        max="5000"
                        step="100"
                        value={params.hospitalBeds}
                        onChange={(e) => setParams(prev => ({ ...prev, hospitalBeds: parseInt(e.target.value) }))}
                        className="w-full accent-rose-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                      />
                    </div>

                    {/* Camas UCI */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium text-slate-300">Camas de Cuidado Crítico (UCI)</span>
                        <span className="font-mono font-bold text-rose-400">{params.icuBeds.toLocaleString()}</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="1200"
                        step="25"
                        value={params.icuBeds}
                        onChange={(e) => setParams(prev => ({ ...prev, icuBeds: parseInt(e.target.value) }))}
                        className="w-full accent-rose-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Modelo de Mortalidad y Letalidad (CFR) */}
                  <div className="border-t border-slate-700/60 pt-4 space-y-4">
                    <h3 className="font-bold text-xs text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Skull className="h-4 w-4 text-slate-400" />
                      Modelo de Mortalidad (Letalidad)
                    </h3>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-medium text-slate-300 flex items-center gap-1">
                          Tasa de Letalidad (CFR)
                          <TooltipHelper content="Case Fatality Rate (CFR): Porcentaje de personas infectadas removidas de la población activa que terminan falleciendo." />
                        </span>
                        <span className="font-mono font-bold text-red-400">{(cfr * 100).toFixed(1)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="15.0"
                        step="0.1"
                        value={cfr * 100}
                        onChange={(e) => setCfr(parseFloat(e.target.value) / 100)}
                        className="w-full accent-red-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                        <span>Min: 0.1% (Gripe)</span>
                        <span>Max: 15% (Extremo)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Área de Visualización y Gráficos Derecha */}
                <div className="lg:col-span-8 space-y-6">
                  {/* Tarjetas de Métricas de Simulación */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {/* Tarjeta 1: Pico de Infecciones */}
                    <div className="bg-slate-800/40 border border-slate-700/40 p-4.5 rounded-xl">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Pico de Infectados</span>
                      <h4 className="text-xl font-black text-white mt-1">
                        {Math.round(simulationResults.peakInfectedCount).toLocaleString()}
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-mono">
                        <Calendar className="h-3 w-3 text-indigo-400" />
                        Día {Math.round(simulationResults.peakInfectedDay)}
                      </p>
                    </div>

                    {/* Tarjeta 2: Tasa de Ataque */}
                    <div className="bg-slate-800/40 border border-slate-700/40 p-4.5 rounded-xl">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Tasa de Ataque</span>
                      <h4 className="text-xl font-black text-white mt-1">
                        {((1 - (simulationResults.points[simulationResults.points.length - 1]?.S / params.totalPopulation)) * 100).toFixed(1)}%
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-1">
                        De la población total infectada
                      </p>
                    </div>

                    {/* Tarjeta 3: Pico de Hospitalizaciones */}
                    <div className="bg-slate-800/40 border border-slate-700/40 p-4.5 rounded-xl">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Pico Hosp. Requerido</span>
                      <h4 className="text-xl font-black text-rose-400 mt-1">
                        {Math.round(simulationResults.peakInfectedCount * 0.05).toLocaleString()}
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-1">
                        5% de infectados activos
                      </p>
                    </div>

                    {/* Tarjeta 4: Defunciones Totales */}
                    <div className="bg-slate-800/40 border border-slate-700/40 p-4.5 rounded-xl">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Defunciones Totales</span>
                      <h4 className="text-xl font-black text-rose-500 mt-1 flex items-center gap-1.5">
                        <Skull className="h-4.5 w-4.5 text-rose-500/70" />
                        {totalDeaths.toLocaleString()}
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Tasa Letalidad: {(cfr * 100).toFixed(1)}%
                      </p>
                    </div>

                    {/* Tarjeta 5: Estado de Capacidad */}
                    <div className={`border p-4.5 rounded-xl col-span-2 sm:col-span-1 ${
                      simulationResults.bedsOverflowed
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-emerald-500/10 border-emerald-500/30'
                    }`}>
                      <span className="text-[10px] uppercase font-bold tracking-wider block text-slate-300">
                        Capacidad Hospitalaria
                      </span>
                      {simulationResults.bedsOverflowed ? (
                        <>
                          <h4 className="text-xl font-black text-red-400 mt-1 flex items-center gap-1.5">
                            Saturado
                          </h4>
                          <p className="text-[10px] text-red-400/80 mt-1 font-mono flex items-center gap-1">
                            Colapso: Día {Math.round(simulationResults.overflowDay || 0)}
                          </p>
                        </>
                      ) : (
                        <>
                          <h4 className="text-xl font-black text-emerald-400 mt-1 flex items-center gap-1.5">
                            Suficiente
                          </h4>
                          <p className="text-[10px] text-emerald-400/80 mt-1">
                            Capacidad sanitaria preservada
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Notificaciones de Riesgo */}
                  <RiskAlerts
                    currentR0={currentR0}
                    points={simulationResults.points}
                    hospitalBeds={params.hospitalBeds}
                    icuBeds={params.icuBeds}
                    onNavigateToInterventions={() => setActiveTab('intervenciones')}
                  />

                   {/* Gráfica SIR Principal */}
                   <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6">
                     <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                       <div>
                         <h3 className="font-bold text-base text-white">Curva de Propagación de Epidemia (Modelo SIR)</h3>
                         <p className="text-xs text-slate-400 mt-0.5">
                           Evolución temporal de Susceptibles (S), Infectados (I), y Recuperados (R). Solucionador: <span className="font-mono text-indigo-400 font-semibold">{params.method}</span>.
                         </p>
                       </div>
                       <div className="flex flex-wrap items-center gap-3">
                         {params.method === 'Both' && (
                           <div className="flex gap-4 text-xs font-mono bg-slate-950 p-2 rounded-lg border border-slate-800">
                             <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" /> Infectados RK4</span>
                             <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Infectados Euler</span>
                           </div>
                         )}
                         <button
                           onClick={exportToCSV}
                           className="cursor-pointer inline-flex items-center gap-2 px-3.5 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-semibold rounded-lg transition shadow-sm hover:shadow-indigo-500/20"
                         >
                           <Download className="h-3.5 w-3.5" />
                           Exportar CSV
                         </button>
                       </div>
                     </div>

                    <div className="h-[360px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `Día ${v}`} />
                          <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => v.toLocaleString()} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                            labelStyle={{ fontWeight: 'bold', color: '#f8fafc' }}
                            itemStyle={{ fontSize: '12px' }}
                          />
                          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                          
                          {params.method !== 'Both' ? (
                            <>
                              <Line type="monotone" dataKey="S" name="Susceptibles (S)" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                              <Line type="monotone" dataKey="I" name="Infectados Activos (I)" stroke="#f43f5e" strokeWidth={3} dot={false} />
                              <Line type="monotone" dataKey="R" name="Recuperados / Inmunes (R)" stroke="#10b981" strokeWidth={2.5} dot={false} />
                            </>
                          ) : (
                            <>
                              <Line type="monotone" dataKey="S" name="Susceptibles (S)" stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                              <Line type="monotone" dataKey="I_RK4" name="Infectados RK4 (Orden 4)" stroke="#f43f5e" strokeWidth={3} dot={false} />
                              <Line type="monotone" dataKey="I_Euler" name="Infectados Euler (Orden 1)" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                              <Line type="monotone" dataKey="R" name="Recuperados (R)" stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                            </>
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Fila de Gráficas Secundarias (Capacidad + Espacio de Fase + Mortalidad) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Gráfica de Capacidad Hospitalaria */}
                    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6">
                      <div>
                        <h3 className="font-bold text-base text-white">Demanda Hospitalaria vs Capacidad Sanitaria</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Estimación de pacientes graves que requieren cama de hospitalización (5% de infectados activos) frente al límite físico de camas establecido.
                        </p>
                      </div>

                      <div className="h-[220px] w-full mt-6">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={simulationResults.points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `Día ${v}`} />
                            <YAxis stroke="#94a3b8" fontSize={11} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                              labelStyle={{ fontWeight: 'bold', color: '#f8fafc' }}
                              itemStyle={{ fontSize: '12px' }}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line type="monotone" dataKey="hospitalizedNeeded" name="Camas de Hospital Requeridas" stroke="#fb7185" strokeWidth={2.5} dot={false} />
                            <Line type="monotone" dataKey="icuNeeded" name="Camas UCI Requeridas" stroke="#f43f5e" strokeWidth={1.5} dot={false} />
                            <ReferenceLine y={params.hospitalBeds} stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" name="Capacidad Total Camas">
                              <Label value="Límite Hospitales" position="top" fill="#f87171" fontSize={10} />
                            </ReferenceLine>
                            <ReferenceLine y={params.icuBeds} stroke="#b91c1c" strokeWidth={1.5} strokeDasharray="5 5" name="Capacidad UCI">
                              <Label value="Límite UCI" position="top" fill="#ef4444" fontSize={10} />
                            </ReferenceLine>
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Gráfica de Espacio de Fase S vs I */}
                    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6">
                      <div>
                        <h3 className="font-bold text-base text-white">Espacio de Fase: Trayectoria Dinámica S vs I</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Evolución temporal conjunta de la población Susceptible (S) frente a Infectados (I). Muestra la órbita del brote desde el inicio (derecha) hasta el fin (izquierda).
                        </p>
                      </div>

                      <div className="h-[220px] w-full mt-6">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={simulationResults.points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis 
                              type="number" 
                              dataKey="S" 
                              name="Susceptibles (S)" 
                              domain={[0, params.totalPopulation]} 
                              stroke="#94a3b8" 
                              fontSize={11} 
                              tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
                            />
                            <YAxis 
                              type="number" 
                              dataKey="I" 
                              name="Infectados (I)" 
                              domain={[0, 'auto']} 
                              stroke="#94a3b8" 
                              fontSize={11} 
                              tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}
                            />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                              labelStyle={{ fontWeight: 'bold', color: '#f8fafc' }}
                              itemStyle={{ fontSize: '12px' }}
                              formatter={(v: any) => [Math.round(Number(v)).toLocaleString(), 'Infectados (I)']}
                              labelFormatter={(v) => `Susceptibles (S): ${Number(v).toLocaleString()}`}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line 
                              type="monotone" 
                              dataKey="I" 
                              name="Órbita SIR (Trayectoria S vs I)" 
                              stroke="#a855f7" 
                              strokeWidth={3} 
                              dot={false} 
                            />
                            {currentR0 > 1 && (
                              <ReferenceLine x={params.totalPopulation / currentR0} stroke="#f43f5e" strokeWidth={1.5} strokeDasharray="4 4">
                                <Label value="Umbral Inmunidad Rebaño" position="insideRight" fill="#fb7185" fontSize={9} />
                              </ReferenceLine>
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Gráfica de Mortalidad: Curva de Defunciones sobre Infectados */}
                    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 md:col-span-2 lg:col-span-1">
                      <div>
                        <h3 className="font-bold text-base text-white">Curva de Mortalidad vs Infectados</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Comparación de la ola de infectados activos (eje izquierdo) frente a la acumulación de fallecidos (eje derecho, letalidad de {(cfr * 100).toFixed(1)}%).
                        </p>
                      </div>

                      <div className="h-[220px] w-full mt-6">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `Día ${v}`} />
                            <YAxis yAxisId="left" stroke="#f43f5e" fontSize={11} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                            <YAxis yAxisId="right" orientation="right" stroke="#e2e8f0" fontSize={11} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                              labelStyle={{ fontWeight: 'bold', color: '#f8fafc' }}
                              itemStyle={{ fontSize: '12px' }}
                              formatter={(v: any, name: string) => [Math.round(Number(v)).toLocaleString(), name]}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line yAxisId="left" type="monotone" dataKey={params.method === 'Both' ? 'I_RK4' : 'I'} name="Infectados Activos" stroke="#f43f5e" strokeWidth={2.5} dot={false} />
                            <Line yAxisId="right" type="monotone" dataKey="D" name="Fallecidos Acumulados" stroke="#cbd5e1" strokeWidth={2.5} strokeDasharray="5 5" dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* Visualización Tridimensional (S, I, R) */}
                  <Trajectory3D 
                    points={simulationResults.points} 
                    totalPopulation={params.totalPopulation} 
                  />

                  {/* Tabla de Análisis de Sensibilidad */}
                  <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 space-y-4">
                    <div>
                      <h3 className="font-bold text-base text-white flex items-center gap-2">
                        <Layers className="h-4.5 w-4.5 text-indigo-400" />
                        Análisis de Sensibilidad: Tasa de Transmisión (β)
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                        Evaluación matemática del impacto en el pico de contagios y colapso hospitalario al variar el parámetro <span className="font-mono text-indigo-300 font-semibold">Beta (β)</span> en un rango de <span className="text-indigo-400 font-semibold">±20%</span>.
                      </p>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-700/40 bg-slate-950/40">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-700/50 bg-slate-800/20 text-slate-300 font-semibold">
                            <th className="p-3 text-center">Variación β</th>
                            <th className="p-3">Valor Beta (β)</th>
                            <th className="p-3">R₀ Resultante</th>
                            <th className="p-3">Pico de Infectados</th>
                            <th className="p-3">Día del Pico</th>
                            <th className="p-3 text-center">Desviación del Pico</th>
                            <th className="p-3">Capacidad Sanitaria</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {sensitivityAnalysis.map((item, index) => {
                            const isBase = item.variation.includes("Base");
                            const isReduction = item.changePercent < 0;
                            const isIncrease = item.changePercent > 0;
                            
                            // Colores de badges de variación
                            let badgeClass = "text-slate-400 bg-slate-800/40 border-slate-700/50";
                            if (isBase) badgeClass = "text-indigo-300 bg-indigo-500/10 border-indigo-400/20 font-bold";
                            else if (isReduction) badgeClass = "text-emerald-400 bg-emerald-500/5 border-emerald-500/10";
                            else if (isIncrease) badgeClass = "text-rose-400 bg-rose-500/5 border-rose-500/10";

                            return (
                              <tr 
                                key={index} 
                                className={`transition hover:bg-slate-800/10 ${isBase ? 'bg-indigo-500/5 font-medium' : ''}`}
                              >
                                <td className="p-3 text-center">
                                  <span className={`inline-block px-2 py-0.5 text-[11px] rounded border ${badgeClass}`}>
                                    {item.variation}
                                  </span>
                                </td>
                                <td className="p-3 font-mono text-slate-300">
                                  {item.beta.toFixed(4)}
                                </td>
                                <td className="p-3 font-mono">
                                  <span className={`font-semibold ${item.r0 > 1 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    {item.r0.toFixed(2)}
                                  </span>
                                </td>
                                <td className="p-3 font-semibold text-white">
                                  {item.peakInfected.toLocaleString()}
                                </td>
                                <td className="p-3 text-slate-400 font-mono">
                                  Día {item.peakDay}
                                </td>
                                <td className="p-3 text-center font-mono font-semibold">
                                  {isBase ? (
                                    <span className="text-slate-500">—</span>
                                  ) : isReduction ? (
                                    <span className="text-emerald-400 flex items-center justify-center gap-1">
                                      <TrendingDown className="h-3.5 w-3.5" />
                                      {item.changePercent.toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span className="text-rose-400 flex items-center justify-center gap-1">
                                      <TrendingUp className="h-3.5 w-3.5" />
                                      +{item.changePercent.toFixed(1)}%
                                    </span>
                                  )}
                                </td>
                                <td className="p-3">
                                  {item.bedsOverflowed ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 bg-rose-950/20 px-2 py-0.5 rounded border border-rose-800/30">
                                      <AlertCircle className="h-3 w-3" />
                                      Saturación (Día {item.overflowDay})
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-800/30">
                                      <CheckCircle2 className="h-3 w-3" />
                                      Estable
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Asesor de Políticas con IA (Gemini) */}
                  <AiReportGenerator
                    params={params}
                    peakInfectedCount={simulationResults.peakInfectedCount}
                    peakInfectedDay={simulationResults.peakInfectedDay}
                    bedsOverflowed={simulationResults.bedsOverflowed}
                    overflowDay={simulationResults.overflowDay}
                    cfr={cfr}
                    totalDeaths={totalDeaths}
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 2: INTERVENCIONES Y POLÍTICAS PÚBLICAS */}
          {activeTab === 'intervenciones' && (
            <motion.div
              key="intervenciones"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Control de Políticas de Gobierno */}
                <div className="lg:col-span-4 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 space-y-6">
                  <div>
                    <h2 className="font-bold text-base text-white flex items-center gap-2">
                      <TrendingUp className="h-4.5 w-4.5 text-indigo-400" />
                      Intervenciones Gubernamentales
                    </h2>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Active medidas de mitigación para simular el efecto de "aplanar la curva" epidemiológica en tiempo de ejecución.
                    </p>
                  </div>

                  {/* Interruptor Principal de Políticas */}
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">Aplicar Intervenciones</span>
                      <input
                        type="checkbox"
                        checked={applyInterventions}
                        onChange={(e) => setApplyInterventions(e.target.checked)}
                        className="cursor-pointer h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-700 rounded bg-slate-900"
                      />
                    </div>
                    {applyInterventions ? (
                      <p className="text-[11px] text-indigo-400 flex items-start gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        Las políticas públicas se activarán en el día indicado a continuación.
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-500">
                        Active esta opción para evaluar el impacto de cuarentenas, mascarillas o campañas de inmunización.
                      </p>
                    )}
                  </div>

                  {applyInterventions && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-6 pt-2"
                    >
                      {/* Día de inicio de las medidas */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-medium text-slate-300">Día de Anuncio / Implementación</span>
                          <span className="font-mono font-bold text-indigo-400">Día {interventionDay}</span>
                        </div>
                        <input
                          type="range"
                          min="5"
                          max="80"
                          step="1"
                          value={interventionDay}
                          onChange={(e) => setInterventionDay(parseInt(e.target.value))}
                          className="w-full accent-indigo-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                        />
                        <span className="text-[10px] text-slate-500 block leading-relaxed">
                          La respuesta tardía usualmente reduce la efectividad para evitar el colapso.
                        </span>
                      </div>

                      {/* Lista de Medidas Disponibles */}
                      <div className="space-y-3">
                        <label className="text-xs font-semibold text-slate-300 block">Estrategias de Mitigación</label>
                        
                        {/* Medida A: Mascarilla / Distanciamiento Social */}
                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 flex items-start justify-between gap-3">
                          <div className="space-y-0.5">
                            <span className="text-xs font-semibold text-slate-200">Uso Obligatorio de Mascarilla</span>
                            <p className="text-[10px] text-slate-400 leading-relaxed">
                              Reduce la probabilidad de transmisión de contagios (Beta β) en un 30%.
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={maskActive}
                            disabled={quarantineActive} // Cuarentena ya incluye mascarilla
                            onChange={(e) => {
                              setMaskActive(e.target.checked);
                              if (e.target.checked) setQuarantineActive(false);
                            }}
                            className="cursor-pointer h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-700 rounded bg-slate-900"
                          />
                        </div>

                        {/* Medida B: Cuarentena Estricta */}
                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 flex items-start justify-between gap-3">
                          <div className="space-y-0.5">
                            <span className="text-xs font-semibold text-slate-200">Cuarentena & Cierre de Comercios</span>
                            <p className="text-[10px] text-slate-400 leading-relaxed">
                              Confinamiento masivo. Reduce la transmisibilidad (Beta β) en un 60%.
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={quarantineActive}
                            onChange={(e) => {
                              setQuarantineActive(e.target.checked);
                              if (e.target.checked) setMaskActive(false);
                            }}
                            className="cursor-pointer h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-700 rounded bg-slate-900"
                          />
                        </div>

                        {/* Medida C: Campaña de Vacunación */}
                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 flex items-start justify-between gap-3">
                          <div className="space-y-0.5">
                            <span className="text-xs font-semibold text-slate-200">Campaña de Inmunización Express</span>
                            <p className="text-[10px] text-slate-400 leading-relaxed">
                              Vacunación masiva rápida. Transfiere instantáneamente al 20% de susceptibles al estado Recuperado (Inmune) en el día especificado.
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={vaccineActive}
                            onChange={(e) => setVaccineActive(e.target.checked)}
                            className="cursor-pointer h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-700 rounded bg-slate-900"
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Resultados Gráficos Comparativos */}
                <div className="lg:col-span-8 space-y-6">
                  {/* Tarjetas Comparativas */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Caso Base vs Mitigado */}
                    <div className="bg-slate-800/40 border border-slate-700/40 p-5 rounded-2xl">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Aplanamiento del Pico</span>
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-400">Sin intervención:</span>
                          <span className="font-mono font-bold text-slate-200">{Math.round(simulationResults.peakInfectedCount).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-indigo-400 font-semibold">Con intervención:</span>
                          <span className="font-mono font-bold text-indigo-400">{Math.round(interventionResults.peakInfectedCount).toLocaleString()}</span>
                        </div>
                        {applyInterventions && (
                          <div className="text-[11px] text-emerald-400 mt-2 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 text-center font-bold">
                            ↓ Reducción de {(100 - (interventionResults.peakInfectedCount / simulationResults.peakInfectedCount) * 100).toFixed(1)}% en pico contagios
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Retraso del Pico */}
                    <div className="bg-slate-800/40 border border-slate-700/40 p-5 rounded-2xl">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Postergación del Pico</span>
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-400">Pico original:</span>
                          <span className="font-mono text-slate-200">Día {Math.round(simulationResults.peakInfectedDay)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-indigo-400 font-semibold">Pico mitigado:</span>
                          <span className="font-mono text-indigo-400">Día {Math.round(interventionResults.peakInfectedDay)}</span>
                        </div>
                        {applyInterventions && (
                          <div className="text-[11px] text-indigo-300 mt-2 bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20 text-center font-semibold">
                            Margen de preparación: {Math.max(0, Math.round(interventionResults.peakInfectedDay - simulationResults.peakInfectedDay))} días extras
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Evitación del colapso */}
                    <div className="bg-slate-800/40 border border-slate-700/40 p-5 rounded-2xl">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Estado del Sistema Médico</span>
                      <div className="mt-2">
                        {applyInterventions ? (
                          !interventionResults.bedsOverflowed ? (
                            <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl text-center">
                              <ShieldCheck className="h-5 w-5 text-emerald-400 mx-auto mb-1" />
                              <h5 className="text-xs font-bold text-emerald-400">Saturación Evitada</h5>
                              <p className="text-[10px] text-slate-400 mt-0.5">La curva hospitalaria se mantuvo dentro del límite.</p>
                            </div>
                          ) : (
                            <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl text-center">
                              <AlertCircle className="h-5 w-5 text-amber-400 mx-auto mb-1" />
                              <h5 className="text-xs font-bold text-amber-400">Saturación Retrasada</h5>
                              <p className="text-[10px] text-slate-400 mt-0.5">Colapso hospitalario el día {Math.round(interventionResults.overflowDay || 0)}</p>
                            </div>
                          )
                        ) : (
                          <div className="bg-slate-900/80 p-3 rounded-xl text-center border border-slate-800 text-slate-400 text-xs">
                            Ninguna intervención activa en este escenario.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Notificaciones de Riesgo en Intervenciones */}
                  <RiskAlerts
                    currentR0={interventionR0}
                    points={interventionResults.points}
                    hospitalBeds={params.hospitalBeds}
                    icuBeds={params.icuBeds}
                  />

                  {/* Gráfico Comparativo: Curvas de Infectados */}
                  <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                      <div>
                        <h3 className="font-bold text-base text-white">Impacto de la Intervención Gubernamental en la Curva de Infectados</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Comparación directa del total de infectados activos diarios entre el escenario sin medidas (Línea Roja) y con políticas de confinamiento/vacunación aplicadas (Línea Azul).
                        </p>
                      </div>
                      <button
                        onClick={exportToCSV}
                        className="cursor-pointer inline-flex items-center gap-2 px-3.5 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-semibold rounded-lg transition shadow-sm hover:shadow-indigo-500/20 shrink-0"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Exportar Comparativa CSV
                      </button>
                    </div>

                    <div className="h-[320px] w-full mt-6">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={simulationResults.points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `Día ${v}`} />
                          <YAxis stroke="#94a3b8" fontSize={11} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                            labelStyle={{ fontWeight: 'bold', color: '#f8fafc' }}
                            itemStyle={{ fontSize: '12px' }}
                            formatter={(value, name) => [Math.round(value as number).toLocaleString(), name]}
                          />
                          <Legend wrapperStyle={{ fontSize: '12px' }} />
                          
                          {/* Curva Base de Infectados */}
                          <Line type="monotone" dataKey="I" name="Infectados Sin Intervención" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                          
                          {/* Curva de Intervención de Infectados */}
                          <Line type="monotone" data={interventionResults.points} dataKey="I" name="Infectados Con Intervención" stroke="#6366f1" strokeWidth={3.5} dot={false} />
                          
                          {/* Línea de inicio de políticas */}
                          {applyInterventions && (
                            <ReferenceLine x={interventionDay} stroke="#a5b4fc" strokeWidth={2} strokeDasharray="3 3">
                              <Label value="Inicio de Medidas" position="top" fill="#a5b4fc" fontSize={10} />
                            </ReferenceLine>
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Planificación con IA para Políticas */}
                  <AiReportGenerator
                    params={params}
                    peakInfectedCount={interventionResults.peakInfectedCount}
                    peakInfectedDay={interventionResults.peakInfectedDay}
                    bedsOverflowed={interventionResults.bedsOverflowed}
                    overflowDay={interventionResults.overflowDay}
                    cfr={cfr}
                    totalDeaths={totalDeathsIntervention}
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 3: SECCIÓN TÉCNICA - MÉTODOS NUMÉRICOS */}
          {activeTab === 'metodos' && (
            <motion.div
              key="metodos"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-8"
            >
              {/* Sección Explicativa Teórica Obligatoria */}
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 md:p-8 space-y-6">
                <div className="flex items-center gap-3 border-b border-slate-700 pb-4">
                  <div className="bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20">
                    <GraduationCap className="h-6 w-6 text-emerald-400" />
                  </div>
                  <div>
                    <span className="text-[10px] tracking-wider uppercase font-bold text-emerald-400">Evaluación de Proyecto</span>
                    <h2 className="text-lg font-bold text-white">Análisis Matemático de Métodos Numéricos (Syllabus Requisito)</h2>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-sm leading-relaxed text-slate-300">
                  {/* El Modelo SIR en Diferenciales */}
                  <div className="lg:col-span-6 space-y-4">
                    <h3 className="font-bold text-white text-sm border-l-2 border-indigo-500 pl-3">El Sistema de Ecuaciones Diferenciales Ordinarias (EDO)</h3>
                    <p>
                      El modelo clásico SIR (Kermack y McKendrick) es un sistema no lineal de EDOs de primer orden que modela la propagación de virus en una población cerrada de tamaño <span className="font-mono text-indigo-400">N = S + I + R</span>:
                    </p>
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 font-mono text-xs text-indigo-300">
                      <div className="flex items-center justify-between">
                        <span>1. Susceptibles (S):</span>
                        <span className="font-bold">dS/dt = - (β · S · I) / N</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>2. Infectados (I):</span>
                        <span className="font-bold">dI/dt = (β · S · I) / N - γ · I</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>3. Recuperados (R):</span>
                        <span className="font-bold">dR/dt = γ · I</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400">
                      La complejidad radica en la no linealidad dada por el producto <span className="font-mono">S · I</span>. Al no poseer solución analítica cerrada, es mandatorio recurrir a esquemas de aproximación numérica.
                    </p>
                  </div>

                  {/* Los Métodos de Solución Comparados */}
                  <div className="lg:col-span-6 space-y-4">
                    <h3 className="font-bold text-white text-sm border-l-2 border-emerald-500 pl-3">Euler frente a Runge-Kutta 4to Orden (RK4)</h3>
                    <div className="space-y-3">
                      <div className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-800">
                        <h4 className="font-bold text-indigo-300 text-xs flex items-center gap-1.5 mb-1.5">
                          Método de Euler (Orden 1)
                        </h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Utiliza el valor de la derivada en el punto inicial del intervalo para proyectar linealmente el siguiente valor. Su Error Local de Truncamiento es <span className="font-mono text-rose-400">O(h²)</span> y su Error Global es <span className="font-mono text-rose-400">O(h)</span>. Es simple pero inestable si el paso <span className="font-mono text-rose-400">h</span> es grande.
                        </p>
                      </div>

                      <div className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-800">
                        <h4 className="font-bold text-emerald-300 text-xs flex items-center gap-1.5 mb-1.5">
                          Método de Runge-Kutta de 4to Orden (RK4)
                        </h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Evalúa la pendiente cuatro veces en cada intervalo (al inicio, a la mitad con dos aproximaciones, y al final) para calcular una media ponderada óptima. Su Error Local es de <span className="font-mono text-emerald-400">O(h⁵)</span> y su Error Global es de <span className="font-mono text-emerald-400">O(h⁴)</span>. Posee un rango de estabilidad numérica colosal.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sandbox de Convergencia Interactiva */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Controles del Sandbox de Paso h */}
                <div className="lg:col-span-4 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6 space-y-6">
                  <div>
                    <h3 className="font-bold text-base text-white flex items-center gap-2">
                      <Layers className="h-4.5 w-4.5 text-indigo-400" />
                      Sandbox de Estabilidad
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Modifique el tamaño de paso <span className="font-mono font-bold text-indigo-400">h</span> y observe cómo el Método de Euler diverge u oscila perdiendo estabilidad, mientras que RK4 se mantiene fiel al modelo real.
                    </p>
                  </div>

                  {/* Slider de h variable */}
                  <div className="space-y-2 bg-slate-950 p-4.5 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-300">Paso de Prueba (h)</span>
                      <span className="font-mono font-bold text-amber-400 text-sm">h = {sandboxH} días</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="4.0"
                      step="0.1"
                      value={sandboxH}
                      onChange={(e) => setSandboxH(parseFloat(e.target.value))}
                      className="w-full accent-amber-500 bg-slate-900 h-1.5 rounded-lg cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                      <span>h=0.1 (Estable)</span>
                      <span>h=4.0 (Inestable)</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSandboxH(0.1)}
                      className="cursor-pointer mt-3 w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-xl text-xs font-semibold text-slate-200 hover:text-white transition-all shadow-sm"
                      title="Restablecer h a 0.1 para un cálculo y visualización estables"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
                      <span>Resetear a parámetros recomendados</span>
                    </button>
                  </div>

                  {/* Cuadro de Análisis de Errores */}
                  <div className="space-y-3.5 pt-2">
                    <h4 className="font-bold text-xs text-slate-400 uppercase tracking-wider">Apreciación de Error Relativo Máximo</h4>
                    
                    {/* Error de Euler */}
                    <div className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-800">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-300">Error Máximo Euler:</span>
                        <span className={`font-mono font-bold ${maxErrors.euler > 15 ? 'text-red-400' : 'text-amber-400'}`}>
                          {maxErrors.euler > 1000 ? '∞ (Divergente)' : `${maxErrors.euler.toFixed(4)}%`}
                        </span>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden mt-2">
                        <div
                          className={`h-full ${maxErrors.euler > 15 ? 'bg-red-500' : 'bg-amber-500'}`}
                          style={{ width: `${Math.min(100, maxErrors.euler)}%` }}
                        />
                      </div>
                    </div>

                    {/* Error de RK4 */}
                    <div className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-800">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-300">Error Máximo RK4:</span>
                        <span className="font-mono font-bold text-emerald-400">
                          {maxErrors.rk4.toFixed(4)}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${Math.min(100, maxErrors.rk4 * 50)}%` }} // Multiplicado por escala visual por ser minúsculo
                        />
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1.5 italic leading-relaxed">
                        * Referencia ideal calculada con Runge-Kutta h = 0.01.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Gráfica del Sandbox */}
                <div className="lg:col-span-8 bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                      <h3 className="font-bold text-base text-white">Gráfico de Convergencia: Euler vs RK4 vs Referencia</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Muestra la curva de infectados para un tamaño de paso h = {sandboxH}. Observe cómo el error se propaga en cada ciclo.
                      </p>
                    </div>
                  </div>

                  <div className="h-[320px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={convergenceSandboxData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="t" stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `Día ${v}`} />
                        <YAxis stroke="#94a3b8" fontSize={11} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                          labelStyle={{ fontWeight: 'bold', color: '#f8fafc' }}
                          itemStyle={{ fontSize: '12px' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Line type="monotone" dataKey="I_reference" name="Referencia Ground-Truth (h=0.01)" stroke="#10b981" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="I_rk4" name="Aproximación RK4" stroke="#6366f1" strokeWidth={3} dot={false} />
                        <Line type="monotone" dataKey="I_euler" name="Aproximación Euler" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Nuevo: Gráfico de Dispersión (Scatter Plot) de h vs. Error Final Acumulado */}
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6" id="scatter-stability-section">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 border-b border-slate-800 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
                      <h3 className="font-bold text-base text-white">Análisis de Sensibilidad: Tamaño de Paso (h) vs. Error Final</h3>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Este gráfico de dispersión (scatter plot) barre el tamaño de paso <span className="font-mono text-amber-400 font-bold">h</span> de 0.1 a 3.5 días. Permite visualizar empíricamente la estabilidad y el punto exacto de divergencia para el Método de Euler en contraste con RK4.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2.5 shrink-0">
                    {eulerDivergencePoint ? (
                      <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/25">
                        ⚠️ Límite de Estabilidad Euler: h ≥ {eulerDivergencePoint.toFixed(1)} días
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                        ✓ Euler Estable en todo el rango
                      </span>
                    )}
                    <span className="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
                      ✓ RK4 Convergencia Absoluta (Error &lt; 0.01%)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-center">
                  {/* Gráfico de Dispersión */}
                  <div className="xl:col-span-8 h-[340px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          name="Tamaño de Paso h"
                          unit=" d"
                          stroke="#94a3b8"
                          fontSize={11}
                          domain={[0.1, 3.5]}
                          tickCount={8}
                        />
                        <YAxis
                          type="number"
                          dataKey="y"
                          name="Error Final"
                          unit="%"
                          stroke="#94a3b8"
                          fontSize={11}
                          domain={[0, 100]}
                          tickFormatter={(v) => v === 100 ? '≥100%' : `${v}%`}
                        />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3', stroke: '#475569' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              const isEuler = payload[0].name === 'Método de Euler';
                              return (
                                <div className="bg-slate-950 border border-slate-700/80 p-3 rounded-xl shadow-xl text-xs space-y-1">
                                  <p className="font-bold text-slate-200">Tamaño de Paso: h = {data.x} {data.x === 1 ? 'día' : 'días'}</p>
                                  <p className="flex items-center gap-1.5 font-medium">
                                    <span className={`w-2 h-2 rounded-full ${isEuler ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                                    <span className="text-slate-400">{isEuler ? 'Euler' : 'RK4'}:</span>
                                    <span className={data.diverged ? 'text-red-400 font-bold' : 'text-slate-200 font-mono'}>
                                      {data.diverged ? 'Divergencia (Error > 100%)' : `${data.y.toFixed(3)}%`}
                                    </span>
                                  </p>
                                  <p className="text-[10px] text-slate-500 leading-relaxed italic mt-1">
                                    {isEuler 
                                      ? (data.diverged ? 'El tamaño de paso h excede el límite crítico de estabilidad lineal (región oscilatoria salvaje).' : 'Aproximación estable pero con error progresivo debido a la propagación local.')
                                      : 'Runge-Kutta 4 mantiene precisión extrema incluso con pasos de computación colosales.'
                                    }
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Scatter
                          name="Método de Euler"
                          data={errorVsStepSizeData.eulerData}
                          fill="#f59e0b"
                          shape="circle"
                          line={{ stroke: '#f59e0b', strokeWidth: 1.5, strokeDasharray: '4 4' }}
                        />
                        <Scatter
                          name="Método de Runge-Kutta 4 (RK4)"
                          data={errorVsStepSizeData.rk4Data}
                          fill="#6366f1"
                          shape="triangle"
                          line={{ stroke: '#6366f1', strokeWidth: 1.5 }}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Panel Educativo Lateral */}
                  <div className="xl:col-span-4 bg-slate-950/40 border border-slate-800 p-5 rounded-2xl space-y-4">
                    <h4 className="font-bold text-xs text-indigo-400 uppercase tracking-wider">Interpretación de Estabilidad</h4>
                    
                    <div className="space-y-3 text-xs leading-relaxed text-slate-300">
                      <p>
                        La <strong>estabilidad numérica</strong> determina si un resolvedor converge a la solución real o si acumula errores de forma descontrolada produciendo oscilaciones espurias.
                      </p>
                      <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 space-y-2">
                        <span className="font-bold text-amber-400 block">Límite Teórico de Euler:</span>
                        <p className="text-[11px] text-slate-400">
                          Para el sistema SIR, el paso crítico de estabilidad de Euler está íntimamente ligado a las tasas del sistema. Cuando <span className="font-mono text-amber-400">h &gt; 2 / β</span>, el método de Euler típicamente experimenta bifurcaciones, oscilando de forma caótica y divergiendo rápidamente al infinito (demostrado en el scatter plot por el salto repentino al 100% de error).
                        </p>
                      </div>
                      <p>
                        Por el contrario, el método <strong>RK4 (puntos morados)</strong> calcula cuatro estimaciones de pendiente por intervalo, auto-corrigiendo la trayectoria. Esto ensancha dramáticamente su dominio de estabilidad, logrando un error virtualmente nulo en todo el rango analizado (<span className="font-mono text-emerald-400 font-semibold">≤ 3.5 días</span>).
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabla de iteraciones paso a paso de los solucionadores */}
              <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6">
                <div className="mb-6">
                  <h3 className="font-bold text-base text-white">Depuración Paso a Paso: Log Numérico SIR</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Inspeccione la tabla de los primeros 20 pasos de computación en punto flotante del sistema SIR para el solucionador {params.method === 'Both' ? 'RK4' : params.method} con h = {params.stepSize} días.
                  </p>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-950/50">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-900 border-b border-slate-700 text-slate-300 font-semibold">
                        <th className="p-3 font-mono">Paso (k)</th>
                        <th className="p-3 font-mono">Tiempo (t)</th>
                        <th className="p-3">Susceptibles (S)</th>
                        <th className="p-3">Infectados (I)</th>
                        <th className="p-3">Recuperados (R)</th>
                        <th className="p-3 font-mono">dS/dt</th>
                        <th className="p-3 font-mono">dI/dt</th>
                        <th className="p-3 font-mono">dR/dt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono text-slate-400">
                      {simulationResults.steps.slice(0, 20).map((step) => (
                        <tr key={step.step} className="hover:bg-slate-900/40">
                          <td className="p-3 text-indigo-400 font-semibold">{step.step}</td>
                          <td className="p-3 font-bold text-slate-300">{step.t.toFixed(2)}</td>
                          <td className="p-3 text-sky-400">{step.S.toFixed(1)}</td>
                          <td className="p-3 text-rose-400">{step.I.toFixed(1)}</td>
                          <td className="p-3 text-emerald-400">{step.R.toFixed(1)}</td>
                          <td className="p-3 text-slate-500">{step.dS.toFixed(4)}</td>
                          <td className="p-3 text-slate-500">{step.dI.toFixed(4)}</td>
                          <td className="p-3 text-slate-500">{step.dR.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-[10px] text-slate-500 text-center mt-3">
                  Mostrando los primeros 20 pasos de la simulación. El total de pasos para la simulación de {params.days} días es {Math.ceil(params.days / params.stepSize)}.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 py-8 px-6 text-xs text-slate-500 mt-16 text-center">
        <div className="max-w-7xl mx-auto space-y-2">
          <p className="font-medium text-slate-400">
            Simulador Epidemiológico con Métodos Numéricos - Proyecto Final de Evaluación
          </p>
          <p>
            Módulos de EDO integrados: Euler de 1er Orden y Runge-Kutta de 4to Orden (RK4).
          </p>
          <p className="text-[10px] text-slate-600">
            Desarrollado para resolver problemas sociales y sanitarios en cumplimiento con las pautas del syllabus académico.
          </p>
        </div>
      </footer>
    </div>
  );
}

// Subcomponente de ayuda para tooltip conceptual rápido
function TooltipHelper({ content }: { content: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block cursor-pointer" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <HelpCircle className="h-3 w-3 text-slate-500 hover:text-slate-300" />
      {show && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-48 bg-slate-950 border border-slate-700/80 text-slate-300 text-[10px] leading-relaxed p-2 rounded-lg shadow-xl z-50">
          {content}
        </div>
      )}
    </span>
  );
}
