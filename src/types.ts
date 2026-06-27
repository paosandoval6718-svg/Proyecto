/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SimulationParams {
  totalPopulation: number;
  beta: number; // Tasa de transmisión (contact rate)
  gamma: number; // Tasa de recuperación (1 / días de recuperación)
  initialInfected: number;
  initialRecovered: number;
  days: number;
  stepSize: number; // h: paso de integración
  hospitalBeds: number; // Camas generales disponibles
  icuBeds: number; // Camas de UCI disponibles
  method: 'Euler' | 'RK4' | 'Both';
}

export interface SimulationDataPoint {
  day: number;
  S: number; // Susceptibles
  I: number; // Infectados
  R: number; // Recuperados
  totalBedsLimit: number;
  icuBedsLimit: number;
  hospitalizedNeeded: number; // Estimación: ej. 5% de infectados activos necesitan hospitalización
  icuNeeded: number; // Estimación: ej. 1% de infectados activos necesitan UCI
}

export interface IterationStep {
  step: number;
  t: number;
  S: number;
  I: number;
  R: number;
  dS: number;
  dI: number;
  dR: number;
}

export interface ConvergenceComparisonDataPoint {
  t: number;
  I_euler: number;
  I_rk4: number;
  I_reference: number; // Simulación con h muy pequeño (ej. h = 0.01) para evaluar precisión
  error_euler: number;
  error_rk4: number;
}
