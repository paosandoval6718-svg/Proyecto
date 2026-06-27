import React, { useMemo } from 'react';
import { AlertTriangle, ShieldAlert, ShieldCheck, Activity, Users, Flame, Info } from 'lucide-react';
import { SimulationDataPoint } from '../types';

interface RiskAlertsProps {
  currentR0: number;
  points: SimulationDataPoint[];
  hospitalBeds: number;
  icuBeds: number;
  onNavigateToInterventions?: () => void;
}

export default function RiskAlerts({
  currentR0,
  points,
  hospitalBeds,
  icuBeds,
  onNavigateToInterventions
}: RiskAlertsProps) {
  // Calcular picos y días de rebasamiento
  const alertsData = useMemo(() => {
    if (!points || points.length === 0) {
      return {
        maxIcuNeeded: 0,
        maxHospNeeded: 0,
        icuOverflowDay: null,
        icu90PercentDay: null,
        hospOverflowDay: null,
        hosp90PercentDay: null,
      };
    }

    let maxIcuNeeded = 0;
    let maxHospNeeded = 0;
    let icuOverflowDay: number | null = null;
    let icu90PercentDay: number | null = null;
    let hospOverflowDay: number | null = null;
    let hosp90PercentDay: number | null = null;

    points.forEach(pt => {
      if (pt.icuNeeded > maxIcuNeeded) maxIcuNeeded = pt.icuNeeded;
      if (pt.hospitalizedNeeded > maxHospNeeded) maxHospNeeded = pt.hospitalizedNeeded;

      // Primer día que excede la capacidad UCI
      if (pt.icuNeeded > icuBeds && icuOverflowDay === null) {
        icuOverflowDay = pt.day;
      }
      // Primer día que excede el 90% de la capacidad UCI
      if (pt.icuNeeded > icuBeds * 0.9 && icu90PercentDay === null) {
        icu90PercentDay = pt.day;
      }

      // Primer día que excede la capacidad de camas generales
      if (pt.hospitalizedNeeded > hospitalBeds && hospOverflowDay === null) {
        hospOverflowDay = pt.day;
      }
      // Primer día que excede el 90% de la capacidad de camas generales
      if (pt.hospitalizedNeeded > hospitalBeds * 0.9 && hosp90PercentDay === null) {
        hosp90PercentDay = pt.day;
      }
    });

    return {
      maxIcuNeeded,
      maxHospNeeded,
      icuOverflowDay: icuOverflowDay ? Math.round(icuOverflowDay) : null,
      icu90PercentDay: icu90PercentDay ? Math.round(icu90PercentDay) : null,
      hospOverflowDay: hospOverflowDay ? Math.round(hospOverflowDay) : null,
      hosp90PercentDay: hosp90PercentDay ? Math.round(hosp90PercentDay) : null,
    };
  }, [points, icuBeds, hospitalBeds]);

  const {
    maxIcuNeeded,
    maxHospNeeded,
    icuOverflowDay,
    icu90PercentDay,
    hospOverflowDay,
    hosp90PercentDay
  } = alertsData;

  const icuOccupancyPercent = (maxIcuNeeded / icuBeds) * 100;
  const hospOccupancyPercent = (maxHospNeeded / hospitalBeds) * 100;

  // Determinar alertas activas
  const activeAlerts = useMemo(() => {
    const list = [];

    // 1. Alerta de R0
    if (currentR0 > 2.0) {
      const isCritical = currentR0 > 3.0;
      list.push({
        id: 'r0-alert',
        type: isCritical ? 'critical' : 'warning',
        title: isCritical ? '🔴 Transmisión Hiper-Exponencial (R₀ Crítico)' : '⚠️ Ritmo de Contagio Acelerado (R₀ Alto)',
        icon: isCritical ? <Flame className="h-5 w-5 text-red-400" /> : <AlertTriangle className="h-5 w-5 text-amber-400" />,
        message: `El número reproductivo básico R₀ es de ${currentR0.toFixed(2)}, superando el umbral de seguridad de 2.0.`,
        description: isCritical
          ? `Velocidad de propagación extrema. Cada persona infectada contagia en promedio a ${currentR0.toFixed(1)} personas adicionales. Sin medidas de mitigación inmediatas (mascarillas, cuarentenas o vacunación), el brote alcanzará un pico masivo e incontrolable en muy poco tiempo.`
          : `Propagación rápida. Cada infectado propaga la enfermedad a ${currentR0.toFixed(1)} personas. Se recomienda iniciar campañas preventivas y de distanciamiento social para evitar que el brote se intensifique.`,
        stat: `R₀ actual: ${currentR0.toFixed(2)}`,
        statColor: isCritical ? 'text-red-400' : 'text-amber-400',
        recommendation: 'Implementar el uso obligatorio de cubrebocas, suspender eventos masivos y acelerar la distribución de vacunas para reducir la tasa de contacto activa.',
      });
    }

    // 2. Alerta de Camas UCI (más del 90%)
    if (maxIcuNeeded > icuBeds * 0.9) {
      const isOver100 = maxIcuNeeded > icuBeds;
      list.push({
        id: 'icu-alert',
        type: isOver100 ? 'critical' : 'warning',
        title: isOver100 ? '🔴 Colapso Inminente de Camas UCI (Saturación)' : '⚠️ Ocupación Crítica de Camas UCI (>90%)',
        icon: <ShieldAlert className={`h-5 w-5 ${isOver100 ? 'text-red-400' : 'text-amber-400'}`} />,
        message: isOver100
          ? `La demanda máxima de camas de cuidados intensivos alcanzará el ${icuOccupancyPercent.toFixed(1)}% de la capacidad.`
          : `La demanda de camas UCI superará el 90% de la capacidad instalada, alcanzando un pico del ${icuOccupancyPercent.toFixed(1)}%.`,
        description: isOver100
          ? `El sistema experimentará un colapso de camas de terapia intensiva (demanda de ${Math.round(maxIcuNeeded).toLocaleString()} vs. capacidad de ${icuBeds.toLocaleString()}). El desbordamiento comenzará estimado en el Día ${icuOverflowDay}. La falta de cuidados intensivos puede disparar de forma severa la tasa de mortalidad real.`
          : `El margen de seguridad de la infraestructura de terapia intensiva se verá severamente comprometido a partir del Día ${icu90PercentDay}, alcanzando una saturación del ${icuOccupancyPercent.toFixed(1)}% (${Math.round(maxIcuNeeded).toLocaleString()} camas requeridas de ${icuBeds.toLocaleString()} disponibles).`,
        stat: `Demanda Pico UCI: ${Math.round(maxIcuNeeded).toLocaleString()} / ${icuBeds.toLocaleString()} camas`,
        statColor: isOver100 ? 'text-red-400 font-bold' : 'text-amber-400 font-bold',
        recommendation: isOver100 
          ? 'Urgente: Duplicar la capacidad modular de UCI, transferir pacientes no críticos y decretar cuarentenas locales estrictas para aplanar la curva antes de la fecha de desborde.'
          : 'Preparar expansión preventiva de camas UCI y diferir cirugías electivas para reservar espacio hospitalario.',
      });
    }

    // 3. Alerta de Camas Hospitalarias Generales (más del 90%) - Añadido para robustez
    if (maxHospNeeded > hospitalBeds * 0.9) {
      const isOver100 = maxHospNeeded > hospitalBeds;
      list.push({
        id: 'hosp-alert',
        type: isOver100 ? 'critical' : 'warning',
        title: isOver100 ? '🔴 Desbordamiento de Camas Hospitalarias Generales' : '⚠️ Ocupación Elevada de Camas Generales (>90%)',
        icon: <Users className={`h-5 w-5 ${isOver100 ? 'text-red-400' : 'text-amber-400'}`} />,
        message: isOver100
          ? `La demanda de hospitalización alcanzará el ${hospOccupancyPercent.toFixed(1)}% de la capacidad general.`
          : `La demanda de camas generales superará el 90% de la capacidad instalada, alcanzando un pico del ${hospOccupancyPercent.toFixed(1)}%.`,
        description: isOver100
          ? `Las salas generales de hospitalización se saturarán en el Día ${hospOverflowDay}. Se requerirán ${Math.round(maxHospNeeded).toLocaleString()} camas generales, superando las ${hospitalBeds.toLocaleString()} disponibles. Esto forzará el uso de hospitales de campaña y triaje médico.`
          : `La ocupación general de hospitalización entrará en zona de riesgo el Día ${hosp90PercentDay}, limitando la flexibilidad operativa del personal médico ante brotes simultáneos.`,
        stat: `Demanda Pico Gral: ${Math.round(maxHospNeeded).toLocaleString()} / ${hospitalBeds.toLocaleString()} camas`,
        statColor: isOver100 ? 'text-red-400' : 'text-amber-400',
        recommendation: 'Activar protocolos de triaje domiciliario para pacientes con síntomas moderados y habilitar centros de recuperación comunitaria no hospitalarios.',
      });
    }

    return list;
  }, [currentR0, maxIcuNeeded, icuBeds, icuOccupancyPercent, icuOverflowDay, icu90PercentDay, maxHospNeeded, hospitalBeds, hospOccupancyPercent, hospOverflowDay, hosp90PercentDay]);

  const hasCriticalAlert = activeAlerts.some(alert => alert.type === 'critical');

  return (
    <div className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 space-y-4" id="risk-notifications-section">
      <div className="flex justify-between items-center border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Activity className={`h-5 w-5 ${hasCriticalAlert ? 'text-red-500 animate-pulse' : 'text-indigo-400'}`} />
            {activeAlerts.length > 0 && (
              <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${hasCriticalAlert ? 'bg-red-500 animate-ping' : 'bg-amber-400'}`} />
            )}
          </div>
          <div>
            <h3 className="font-bold text-sm text-white">Notificaciones de Riesgo & Alertas</h3>
            <p className="text-[11px] text-slate-400">Análisis dinámico en tiempo real de la seguridad epidemiológica e infraestructura sanitaria.</p>
          </div>
        </div>

        <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full border ${
          activeAlerts.length === 0
            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40'
            : hasCriticalAlert
            ? 'bg-red-950/40 text-red-400 border-red-800/40'
            : 'bg-amber-950/40 text-amber-400 border-amber-800/40'
        }`}>
          {activeAlerts.length === 0 
            ? 'Estado: Seguro' 
            : `${activeAlerts.length} ${activeAlerts.length === 1 ? 'Alerta Activa' : 'Alertas Activas'}`
          }
        </span>
      </div>

      {activeAlerts.length === 0 ? (
        /* Tarjeta de Estado Seguro */
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3.5 transition-all duration-300">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0 mt-0.5">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-xs text-emerald-400 flex items-center gap-1.5">
              ¡Sistema Sanitario Bajo Control!
            </h4>
            <p className="text-[11.5px] text-slate-300 leading-relaxed">
              Los parámetros actuales indican que el brote epidemiológico es controlable. El número reproductivo básico <span className="font-mono text-emerald-400 font-semibold">R₀ ({currentR0.toFixed(2)})</span> se mantiene dentro de rangos manejables (≤ 2.0) y la infraestructura hospitalaria de terapia intensiva (UCI) no excede el límite crítico del 90% en su punto máximo.
            </p>
            <div className="pt-1 text-[10px] text-slate-400 flex items-center gap-1">
              <Info className="h-3 w-3 text-emerald-400" />
              <span>Sigue monitoreando los parámetros para mantener el brote en niveles seguros.</span>
            </div>
          </div>
        </div>
      ) : (
        /* Grid de Alertas Activas */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeAlerts.map(alert => (
            <div
              key={alert.id}
              className={`border rounded-xl p-4 space-y-2.5 flex flex-col justify-between transition-all duration-300 ${
                alert.type === 'critical'
                  ? 'bg-red-500/5 border-red-500/25 hover:border-red-500/40'
                  : 'bg-amber-500/5 border-amber-500/25 hover:border-amber-500/40'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 border-b border-slate-800/40 pb-1.5">
                  <div className={`p-1.5 rounded-lg shrink-0 ${
                    alert.type === 'critical' ? 'bg-red-500/10' : 'bg-amber-500/10'
                  }`}>
                    {alert.icon}
                  </div>
                  <h4 className="font-bold text-[12px] text-slate-200">{alert.title}</h4>
                </div>
                
                <p className="text-[11px] text-slate-300 font-semibold leading-relaxed">
                  {alert.message}
                </p>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {alert.description}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/40 space-y-2">
                <div className="flex justify-between items-center text-[10px] font-mono">
                  <span className="text-slate-500">Métrica clave:</span>
                  <span className={alert.statColor}>{alert.stat}</span>
                </div>
                
                <div className="bg-slate-950/40 rounded-lg p-2 text-[10px] text-slate-300 border border-slate-800/60 leading-relaxed">
                  <span className="font-bold text-slate-400 block mb-0.5">Acción Recomendada:</span>
                  {alert.recommendation}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Botón sugerencia si el usuario está en el simulador base y hay alertas */}
      {activeAlerts.length > 0 && onNavigateToInterventions && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="text-[11px] text-slate-400 text-center sm:text-left">
            <span className="font-bold text-slate-300">💡 ¿Cómo reducir estos riesgos?</span> Las políticas de gobierno como distanciamiento, vacunas o mascarillas pueden frenar drásticamente el brote.
          </div>
          <button
            type="button"
            onClick={onNavigateToInterventions}
            className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-1.5 px-3 rounded-lg shadow-md transition-all shrink-0"
          >
            Configurar Políticas de Mitigación
          </button>
        </div>
      )}
    </div>
  );
}
