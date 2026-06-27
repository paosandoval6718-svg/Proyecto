/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SimulationParams, SimulationDataPoint, IterationStep, ConvergenceComparisonDataPoint } from '../types';

// Definición de las derivadas del modelo SIR
// dS/dt = - (beta * S * I) / N
// dI/dt = (beta * S * I) / N - gamma * I
// dR/dt = gamma * I
export function sirDerivatives(
  S: number,
  I: number,
  R: number,
  beta: number,
  gamma: number,
  N: number
): { dS: number; dI: number; dR: number } {
  // Evitar valores negativos
  const S_safe = Math.max(0, S);
  const I_safe = Math.max(0, I);

  const dS = - (beta * S_safe * I_safe) / N;
  const dI = (beta * S_safe * I_safe) / N - gamma * I_safe;
  const dR = gamma * I_safe;

  return { dS, dI, dR };
}

// 1. Método de Euler para resolver el sistema SIR
export function solveEuler(params: SimulationParams): {
  points: SimulationDataPoint[];
  steps: IterationStep[];
} {
  const { totalPopulation: N, beta, gamma, initialInfected: I0, initialRecovered: R0, days, stepSize: h } = params;
  const S0 = N - I0 - R0;

  const points: SimulationDataPoint[] = [];
  const steps: IterationStep[] = [];

  let S = S0;
  let I = I0;
  let R = R0;
  let t = 0;

  // Hospitalización estimada (ej. 5% de infectados activos necesitan cama general, 1.2% cama UCI)
  const hospRate = 0.05;
  const icuRate = 0.012;

  // Guardar estado inicial
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

  steps.push({
    step: 0,
    t: 0,
    S,
    I,
    R,
    ...sirDerivatives(S, I, R, beta, gamma, N),
  });

  const totalSteps = Math.ceil(days / h);

  for (let k = 1; k <= totalSteps; k++) {
    const deriv = sirDerivatives(S, I, R, beta, gamma, N);

    // Actualización de Euler
    S = S + h * deriv.dS;
    I = I + h * deriv.dI;
    R = R + h * deriv.dR;
    t = k * h;

    // Garantizar conservación de población y valores no negativos
    S = Math.max(0, Math.min(N, S));
    I = Math.max(0, Math.min(N, I));
    R = Math.max(0, Math.min(N, R));

    // Solo registramos los puntos en días enteros o al final del paso para la gráfica
    // Para simplificar, guardamos un punto por día aproximado
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

    // Registrar primeros 50 pasos detallados para la pestaña de explicación
    if (k <= 100) {
      const nextDeriv = sirDerivatives(S, I, R, beta, gamma, N);
      steps.push({
        step: k,
        t,
        S,
        I,
        R,
        ...nextDeriv,
      });
    }
  }

  // Asegurar que haya un punto en el último día
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

  // Ordenar puntos por día
  points.sort((a, b) => a.day - b.day);

  return { points, steps };
}

// 2. Método de Runge-Kutta de 4to Orden (RK4)
export function solveRK4(params: SimulationParams): {
  points: SimulationDataPoint[];
  steps: IterationStep[];
} {
  const { totalPopulation: N, beta, gamma, initialInfected: I0, initialRecovered: R0, days, stepSize: h } = params;
  const S0 = N - I0 - R0;

  const points: SimulationDataPoint[] = [];
  const steps: IterationStep[] = [];

  let S = S0;
  let I = I0;
  let R = R0;
  let t = 0;

  const hospRate = 0.05;
  const icuRate = 0.012;

  // Registrar estado inicial
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

  steps.push({
    step: 0,
    t: 0,
    S,
    I,
    R,
    ...sirDerivatives(S, I, R, beta, gamma, N),
  });

  const totalSteps = Math.ceil(days / h);

  for (let k = 1; k <= totalSteps; k++) {
    // k1
    const k1 = sirDerivatives(S, I, R, beta, gamma, N);

    // k2
    const S_k2 = S + (h / 2) * k1.dS;
    const I_k2 = I + (h / 2) * k1.dI;
    const R_k2 = R + (h / 2) * k1.dR;
    const k2 = sirDerivatives(S_k2, I_k2, R_k2, beta, gamma, N);

    // k3
    const S_k3 = S + (h / 2) * k2.dS;
    const I_k3 = I + (h / 2) * k2.dI;
    const R_k3 = R + (h / 2) * k2.dR;
    const k3 = sirDerivatives(S_k3, I_k3, R_k3, beta, gamma, N);

    // k4
    const S_k4 = S + h * k3.dS;
    const I_k4 = I + h * k3.dI;
    const R_k4 = R + h * k3.dR;
    const k4 = sirDerivatives(S_k4, I_k4, R_k4, beta, gamma, N);

    // Actualización con promedio ponderado de RK4
    S = S + (h / 6) * (k1.dS + 2 * k2.dS + 2 * k3.dS + k4.dS);
    I = I + (h / 6) * (k1.dI + 2 * k2.dI + 2 * k3.dI + k4.dI);
    R = R + (h / 6) * (k1.dR + 2 * k2.dR + 2 * k3.dR + k4.dR);
    t = k * h;

    // Asegurar conservación y límites no negativos
    S = Math.max(0, Math.min(N, S));
    I = Math.max(0, Math.min(N, I));
    R = Math.max(0, Math.min(N, R));

    // Guardar para gráficos (aproximadamente 1 punto por día entero)
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

    // Registrar primeros pasos de forma detallada
    if (k <= 100) {
      const nextDeriv = sirDerivatives(S, I, R, beta, gamma, N);
      steps.push({
        step: k,
        t,
        S,
        I,
        R,
        ...nextDeriv,
      });
    }
  }

  // Asegurar punto del último día
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

  return { points, steps };
}

// 3. Generar comparación de convergencia y errores locales de truncamiento
// Simula Euler, RK4 y un RK4 de referencia con h = 0.01 (considerado el exacto para propósitos educativos)
export function runConvergenceAnalysis(params: SimulationParams): ConvergenceComparisonDataPoint[] {
  const { totalPopulation: N, beta, gamma, initialInfected: I0, initialRecovered: R0, days, stepSize: h } = params;
  const S0 = N - I0 - R0;

  // Simular la Referencia de Alta Precisión (RK4 con h = 0.01)
  const hRef = 0.01;
  const totalRefSteps = Math.ceil(days / hRef);
  const refData: { [key: string]: number } = {};

  let S_ref = S0;
  let I_ref = I0;
  let R_ref = R0;
  refData["0.00"] = I_ref;

  for (let k = 1; k <= totalRefSteps; k++) {
    const k1 = sirDerivatives(S_ref, I_ref, R_ref, beta, gamma, N);
    const k2 = sirDerivatives(S_ref + (hRef/2)*k1.dS, I_ref + (hRef/2)*k1.dI, R_ref + (hRef/2)*k1.dR, beta, gamma, N);
    const k3 = sirDerivatives(S_ref + (hRef/2)*k2.dS, I_ref + (hRef/2)*k2.dI, R_ref + (hRef/2)*k2.dR, beta, gamma, N);
    const k4 = sirDerivatives(S_ref + hRef*k3.dS, I_ref + hRef*k3.dI, R_ref + hRef*k3.dR, beta, gamma, N);

    S_ref = Math.max(0, S_ref + (hRef/6)*(k1.dS + 2*k2.dS + 2*k3.dS + k4.dS));
    I_ref = Math.max(0, I_ref + (hRef/6)*(k1.dI + 2*k2.dI + 2*k3.dI + k4.dI));
    R_ref = Math.max(0, R_ref + (hRef/6)*(k1.dR + 2*k2.dR + 2*k3.dR + k4.dR));
    
    const t = k * hRef;
    // Guardar con precisión de centésimas
    refData[t.toFixed(2)] = I_ref;
  }

  // Ahora simulamos Euler y RK4 con el paso 'h' seleccionado por el usuario y calculamos errores relativos
  const comparison: ConvergenceComparisonDataPoint[] = [];
  const totalSteps = Math.ceil(days / h);

  // Inicial
  comparison.push({
    t: 0,
    I_euler: I0,
    I_rk4: I0,
    I_reference: I0,
    error_euler: 0,
    error_rk4: 0,
  });

  // Euler local states
  let S_e = S0;
  let I_e = I0;
  let R_e = R0;

  // RK4 local states
  let S_rk = S0;
  let I_rk = I0;
  let R_rk = R0;

  for (let k = 1; k <= totalSteps; k++) {
    const t = k * h;
    const tKey = t.toFixed(2);

    // 1 paso de Euler
    const dEuler = sirDerivatives(S_e, I_e, R_e, beta, gamma, N);
    S_e = Math.max(0, S_e + h * dEuler.dS);
    I_e = Math.max(0, I_e + h * dEuler.dI);
    R_e = Math.max(0, R_e + h * dEuler.dR);

    // 1 paso de RK4
    const k1 = sirDerivatives(S_rk, I_rk, R_rk, beta, gamma, N);
    const k2 = sirDerivatives(S_rk + (h/2)*k1.dS, I_rk + (h/2)*k1.dI, R_rk + (h/2)*k1.dR, beta, gamma, N);
    const k3 = sirDerivatives(S_rk + (h/2)*k2.dS, I_rk + (h/2)*k2.dI, R_rk + (h/2)*k2.dR, beta, gamma, N);
    const k4 = sirDerivatives(S_rk + h*k3.dS, I_rk + h*k3.dI, R_rk + h*k3.dR, beta, gamma, N);

    S_rk = Math.max(0, S_rk + (h/6)*(k1.dS + 2*k2.dS + 2*k3.dS + k4.dS));
    I_rk = Math.max(0, I_rk + (h/6)*(k1.dI + 2*k2.dI + 2*k3.dI + k4.dI));
    R_rk = Math.max(0, R_rk + (h/6)*(k1.dR + 2*k2.dR + 2*k3.dR + k4.dR));

    // Obtener la referencia más cercana
    const refVal = refData[tKey] ?? I_rk; // Fallback a rk4 si no hay coincidencia exacta

    // Error relativo porcentual o absoluto si es cero
    const error_e = refVal > 0 ? (Math.abs(I_e - refVal) / refVal) * 100 : Math.abs(I_e - refVal);
    const error_rk = refVal > 0 ? (Math.abs(I_rk - refVal) / refVal) * 100 : Math.abs(I_rk - refVal);

    // Solo agregar puntos representativos para no saturar (ej: saltando algunos si h es minúsculo)
    // Guardamos si es múltiplo de 1 o si el paso es grande
    if (h >= 1 || (k % Math.ceil(1/h) === 0) || k === totalSteps) {
      comparison.push({
        t: Math.round(t * 100) / 100,
        I_euler: Math.round(I_e),
        I_rk4: Math.round(I_rk),
        I_reference: Math.round(refVal),
        error_euler: parseFloat(error_e.toFixed(4)),
        error_rk4: parseFloat(error_rk.toFixed(4)),
      });
    }
  }

  return comparison;
}
