import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini SDK with recommended settings
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("WARNING: GEMINI_API_KEY environment variable is not set.");
  }
  return new GoogleGenAI({
    apiKey: apiKey || "",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

// API Endpoint: Analyze simulation results and provide public health policy recommendations
app.post("/api/gemini/analyze", async (req, res) => {
  try {
    const {
      totalPopulation,
      beta,
      gamma,
      initialInfected,
      days,
      hospitalBeds,
      icuBeds,
      peakInfectedCount,
      peakInfectedDay,
      bedsOverflowed,
      overflowDay,
      methodUsed,
      cfr,
      totalDeaths
    } = req.body;

    // Validate inputs briefly
    if (!totalPopulation || !beta || !gamma) {
      return res.status(400).json({ error: "Faltan parámetros obligatorios de simulación." });
    }

    const ai = getGeminiClient();
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "La API Key de Gemini no está configurada. Por favor, añádela en la pestaña Settings > Secrets de AI Studio."
      });
    }

    const prompt = `
Actúa como un epidemiólogo experto y asesor principal del Ministerio de Salud.
Analiza el siguiente escenario epidemiológico modelado mediante el método numérico de resolución de ecuaciones diferenciales ordinarias (${methodUsed}) para el modelo SIR (Susceptibles, Infectados, Recuperados) con extensión de mortalidad.

DATOS CLAVE DE LA SIMULACIÓN:
- Población Total: ${totalPopulation.toLocaleString()} habitantes
- Tasa de Transmisión (Beta): ${beta.toFixed(3)} (probabilidad de contagio por contacto por día)
- Tasa de Recuperación (Gamma): ${gamma.toFixed(3)} (equivalente a un período infeccioso de ${(1 / gamma).toFixed(1)} días)
- Número Reproductivo Básico R0 estimado (Beta / Gamma): ${(beta / gamma).toFixed(2)}
- Casos Iniciales Infectados: ${initialInfected.toLocaleString()}
- Duración de la Simulación: ${days} días
- Camas de Hospitalización Disponibles: ${hospitalBeds.toLocaleString()}
- Camas de UCI (Unidad de Cuidados Intensivos) Disponibles: ${icuBeds.toLocaleString()}
- Tasa de Letalidad (CFR): ${cfr ? (cfr * 100).toFixed(1) : '1.0'}% (porcentaje de recuperados/removidos que fallecen)

RESULTADOS OBTENIDOS POR EL MÉTODO NUMÉRICO:
- Día del Pico de Infecciones: Día ${Math.round(peakInfectedDay)}
- Total de Infectados Activos en el Pico: ${Math.round(peakInfectedCount).toLocaleString()} (${((peakInfectedCount / totalPopulation) * 100).toFixed(1)}% de la población)
- Fallecidos Totales Estimados: ${totalDeaths ? Math.round(totalDeaths).toLocaleString() : 'N/A'} habitantes
- ¿Se superó la capacidad de camas hospitalarias?: ${bedsOverflowed ? 'SÍ, colapso del sistema sanitario' : 'NO, la capacidad fue suficiente'}
${bedsOverflowed && overflowDay ? `- Día estimado de inicio del colapso (desbordamiento de camas): Día ${Math.round(overflowDay)}` : ''}

INSTRUCCIONES DE RESPUESTA:
Genera un informe técnico de asesoría gubernamental riguroso y profesional redactado en ESPAÑOL. Debe estar estructurado con las siguientes secciones en formato Markdown:

1. **🩺 Resumen Ejecutivo**: Un resumen de 2-3 frases del impacto del brote, mortalidad esperada y si la infraestructura de salud pública resistirá.
2. **📈 Análisis del Brote e Impacto Demográfico**: Evaluación epidemiológica detallada basada en el R0, velocidad de contagio, duración del pico y proyección de fallecidos acumulados (${totalDeaths ? Math.round(totalDeaths).toLocaleString() : 'N/A'}). Explica cómo la resolución numérica (usando ${methodUsed}) permite a los gobernantes prever con precisión matemática este escenario.
3. **🚨 Impacto en la Capacidad Sanitaria y Mortalidad**: Analiza qué tan crítico es el pico de infección con respecto a las ${hospitalBeds.toLocaleString()} camas generales y ${icuBeds.toLocaleString()} camas UCI. Si hay desbordamiento, advierte sobre las consecuencias del colapso en el día ${overflowDay ? Math.round(overflowDay) : 'N/A'} y cómo esto agravaría la tasa de letalidad real.
4. **🛡️ Recomendaciones de Políticas Públicas**: Ofrece un conjunto de 3 o 4 medidas de contención e intervención basadas en la severidad (ej. distanciamiento social, cuarentenas focalizadas, uso obligatorio de mascarillas, aceleración de vacunación, expansión de capacidad hospitalaria). Describe específicamente el número de vidas potenciales que podrían salvarse si se reduce la tasa de ataque y los fallecimientos esperados.

Escribe de manera formal, académica, clara y persuasiva para autoridades gubernamentales.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    res.json({ report: response.text });
  } catch (error: any) {
    console.error("Error en /api/gemini/analyze:", error);
    res.status(500).json({ error: error.message || "Error interno del servidor al consultar a Gemini." });
  }
});

// Setup Vite development server or production static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Iniciando en modo DESARROLLO (Vite Middleware)");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Iniciando en modo PRODUCCIÓN (Archivos Estáticos)");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor Express corriendo en http://0.0.0.0:${PORT}`);
  });
}

startServer();
