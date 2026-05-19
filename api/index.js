// ============================================
// BOT DE PRONÓSTICOS - MUNDIAL 2026
// ============================================

// Cargar variables de entorno desde .env
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");

// Inicializar Express (el servidor web)
const app = express();
app.use(express.json());

// Inicializar el cliente de Claude (la IA)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================
// FUNCIÓN: Obtener estadísticas de un equipo
// Llama a API-Football para traer datos reales
// ============================================
async function obtenerEstadisticasEquipo(nombreEquipo) {
  try {
    // Buscar el equipo por nombre
    const respuesta = await axios.get("https://v3.football.api-sports.io/teams", {
      headers: {
        "x-apisports-key": process.env.FOOTBALL_API_KEY,
      },
      params: {
        name: nombreEquipo,
      },
    });

    // Si encontró el equipo, devuelve sus datos básicos
    if (respuesta.data.response && respuesta.data.response.length > 0) {
      const equipo = respuesta.data.response[0].team;
      return {
        id: equipo.id,
        nombre: equipo.name,
        pais: equipo.country,
        fundado: equipo.founded,
      };
    }

    return null;
  } catch (error) {
    console.error("Error al obtener estadísticas:", error.message);
    return null;
  }
}

// ============================================
// FUNCIÓN: Generar pronóstico con Claude (IA)
// Recibe datos de ambos equipos y genera análisis
// ============================================
async function generarPronostico(equipo1, equipo2, datosEquipo1, datosEquipo2) {
  // Este es el "prompt" que le manda instrucciones a Claude
  const prompt = `Eres un experto analista de fútbol para el Mundial 2026. 
  
Analiza el siguiente partido y genera un pronóstico detallado en español:

PARTIDO: ${equipo1} vs ${equipo2}

DATOS EQUIPO 1 - ${equipo1}:
${datosEquipo1 ? JSON.stringify(datosEquipo1, null, 2) : "Datos no disponibles"}

DATOS EQUIPO 2 - ${equipo2}:
${datosEquipo2 ? JSON.stringify(datosEquipo2, null, 2) : "Datos no disponibles"}

Por favor genera un análisis que incluya:
1. 📊 ANÁLISIS DE AMBOS EQUIPOS (fortalezas y debilidades)
2. ⚽ FACTORES CLAVE DEL PARTIDO
3. 🔮 PRONÓSTICO (quién tiene más probabilidades de ganar y por qué)
4. 📈 POSIBLE MARCADOR
5. ⚠️ ADVERTENCIA: Recuerda mencionar que el fútbol es impredecible y esto es solo un análisis estadístico

Sé específico, entretenido y útil para alguien que quiere entender mejor el partido.`;

  // Llamar a la API de Claude
  const mensaje = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  // Devolver el texto de la respuesta
  return mensaje.content[0].text;
}

// ============================================
// ENDPOINT PRINCIPAL: POST /pronostico
// Aquí llegan las peticiones del usuario
// Uso: {"equipo1": "Mexico", "equipo2": "Argentina"}
// ============================================
app.post("/pronostico", async (req, res) => {
  const { equipo1, equipo2 } = req.body;

  // Validar que se enviaron ambos equipos
  if (!equipo1 || !equipo2) {
    return res.status(400).json({
      error: "Debes enviar equipo1 y equipo2",
      ejemplo: { equipo1: "Mexico", equipo2: "Argentina" },
    });
  }

  console.log(`🔍 Buscando pronóstico: ${equipo1} vs ${equipo2}`);

  try {
    // 1. Obtener datos de ambos equipos en paralelo (más rápido)
    const [datosEquipo1, datosEquipo2] = await Promise.all([
      obtenerEstadisticasEquipo(equipo1),
      obtenerEstadisticasEquipo(equipo2),
    ]);

    // 2. Generar el análisis con Claude
    const pronostico = await generarPronostico(
      equipo1,
      equipo2,
      datosEquipo1,
      datosEquipo2
    );

    // 3. Devolver la respuesta
    res.json({
      partido: `${equipo1} vs ${equipo2}`,
      analisis: pronostico,
      generado: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({
      error: "Hubo un error al generar el pronóstico",
      detalle: error.message,
    });
  }
});

// ============================================
// ENDPOINT: GET / — Página de bienvenida
// Para verificar que el servidor está corriendo
// ============================================
app.get("/", (req, res) => {
  res.json({
    mensaje: "🏆 Bot de Pronósticos Mundial 2026 funcionando",
    uso: "Manda POST a /pronostico con {equipo1, equipo2}",
    ejemplo: { equipo1: "Mexico", equipo2: "Argentina" },
  });
});

// ============================================
// INICIAR EL SERVIDOR
// ============================================
const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PUERTO}`);
  console.log(`⚽ Bot del Mundial 2026 listo para recibir consultas`);
});
