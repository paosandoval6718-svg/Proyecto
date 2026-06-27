/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Sparkles, Loader2, AlertCircle, ShieldAlert, CheckCircle2, FileText, Download } from 'lucide-react';
import { SimulationParams } from '../types';

interface AiReportGeneratorProps {
  params: SimulationParams;
  peakInfectedCount: number;
  peakInfectedDay: number;
  bedsOverflowed: boolean;
  overflowDay: number | null;
  cfr: number;
  totalDeaths: number;
}

export default function AiReportGenerator({
  params,
  peakInfectedCount,
  peakInfectedDay,
  bedsOverflowed,
  overflowDay,
  cfr,
  totalDeaths,
}: AiReportGeneratorProps) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);

  const loadingMessages = [
    "Recopilando resultados del modelo numérico (Euler / RK4)...",
    "Analizando el Número Reproductivo Básico (R₀ = " + (params.beta / params.gamma).toFixed(2) + ")...",
    "Evaluando la tasa de colapso sanitario y camas UCI...",
    "Generando recomendaciones epidemiológicas basadas en evidencia con Gemini AI...",
    "Redactando informe oficial para el Ministerio de Salud..."
  ];

  const generateReport = async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    setLoadingStep(0);

    // Ciclar mensajes de carga cada 2.5 segundos para mejorar la experiencia de usuario
    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev + 1) % loadingMessages.length);
    }, 2500);

    try {
      const response = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalPopulation: params.totalPopulation,
          beta: params.beta,
          gamma: params.gamma,
          initialInfected: params.initialInfected,
          days: params.days,
          hospitalBeds: params.hospitalBeds,
          icuBeds: params.icuBeds,
          peakInfectedCount,
          peakInfectedDay,
          bedsOverflowed,
          overflowDay,
          methodUsed: params.method === 'Both' ? 'Runge-Kutta 4to Orden' : params.method,
          cfr,
          totalDeaths,
        }),
      });

      const data = await response.json();
      clearInterval(interval);

      if (!response.ok) {
        throw new Error(data.error || "Ocurrió un error al generar el reporte.");
      }

      setReport(data.report);
    } catch (err: any) {
      clearInterval(interval);
      setError(err.message || "Error al conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  };

  // Función simple para renderizar markdown básico a HTML seguro sin dependencias pesadas
  const renderSimpleMarkdown = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      // Títulos H1/H2/H3
      if (line.startsWith('### ')) {
        return <h4 key={idx} className="text-lg font-semibold text-slate-800 mt-5 mb-2 border-b border-slate-100 pb-1">{line.replace('### ', '')}</h4>;
      }
      if (line.startsWith('## ')) {
        return <h3 key={idx} className="text-xl font-bold text-indigo-900 mt-6 mb-3 border-b border-indigo-100 pb-2 flex items-center gap-2"> {line.replace('## ', '')}</h3>;
      }
      if (line.startsWith('# ')) {
        return <h2 key={idx} className="text-2xl font-black text-slate-900 mt-7 mb-4 border-b-2 border-slate-200 pb-2">{line.replace('# ', '')}</h2>;
      }

      // Viñetas
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        const content = line.trim().substring(2);
        return (
          <li key={idx} className="ml-5 list-disc text-slate-600 mb-1 leading-relaxed">
            {parseBoldText(content)}
          </li>
        );
      }

      // Líneas vacías
      if (line.trim() === '') {
        return <div key={idx} className="h-2"></div>;
      }

      // Párrafos normales
      return <p key={idx} className="text-slate-600 leading-relaxed mb-3">{parseBoldText(line)}</p>;
    });
  };

  // Parseador de negritas simple **texto**
  const parseBoldText = (text: string) => {
    const parts = text.split('**');
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return <strong key={i} className="font-semibold text-slate-900">{part}</strong>;
      }
      return part;
    });
  };

  const downloadReport = () => {
    if (!report) return;
    const element = document.createElement("a");
    const file = new Blob([report], { type: 'text/plain;charset=utf-8' });
    element.href = URL.createObjectURL(file);
    element.download = `Reporte_Epidemiologico_Ministerio_Salud_R0_${(params.beta / params.gamma).toFixed(2)}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-600" />
            Asesor de Políticas de Salud Pública con IA
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Gemini analizará matemáticamente los resultados de la simulación numérica (Euler/RK4) y redactará un informe técnico oficial para el Ministerio de Salud.
          </p>
        </div>
        
        {!report && !loading && (
          <button
            onClick={generateReport}
            className="cursor-pointer inline-flex items-center justify-center gap-2 px-5 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-medium text-sm rounded-xl transition shadow-md hover:shadow-lg active:scale-95"
          >
            <Sparkles className="h-4 w-4" />
            Generar Informe de Asesoría con IA
          </button>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <Loader2 className="h-10 w-10 text-indigo-600 animate-spin mb-4" />
          <h4 className="font-semibold text-slate-800 text-base mb-1 animate-pulse">
            {loadingMessages[loadingStep]}
          </h4>
          <p className="text-xs text-slate-400 max-w-sm">
            Esto puede tardar unos segundos mientras resolvemos el escenario y realizamos el análisis predictivo.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-sm">No se pudo generar el reporte</h4>
            <p className="text-xs text-red-600 mt-1">{error}</p>
            <button
              onClick={generateReport}
              className="mt-3 text-xs bg-white text-red-700 border border-red-300 px-3 py-1.5 rounded-lg hover:bg-red-100 font-medium transition cursor-pointer"
            >
              Reintentar generación
            </button>
          </div>
        </div>
      )}

      {report && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-inner animate-fade-in relative">
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-50 p-2 rounded-lg">
                <FileText className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <span className="text-[10px] tracking-wider uppercase font-bold text-indigo-600">Documento de Gobierno</span>
                <h4 className="text-sm font-bold text-slate-900">INFORME TÉCNICO DE ASESORÍA EPIDEMIOLÓGICA</h4>
              </div>
            </div>
            
            <button
              onClick={downloadReport}
              title="Descargar Reporte"
              className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 rounded-lg bg-white hover:bg-indigo-50/50 transition font-medium"
            >
              <Download className="h-3.5 w-3.5" />
              Descargar (.txt)
            </button>
          </div>

          <div className="prose prose-slate max-w-none text-sm leading-relaxed">
            {renderSimpleMarkdown(report)}
          </div>

          <div className="mt-8 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400">
            <span>Generado dinámicamente con Gemini 3.5-Flash</span>
            <span className="mt-1 sm:mt-0">Validez predictiva dependiente de la precisión numérica seleccionada (h={params.stepSize})</span>
          </div>
        </div>
      )}
    </div>
  );
}
