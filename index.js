require("dotenv").config();
const express = require("express");
const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function football(endpoint, params = {}) {
  const res = await axios.get(`https://v3.football.api-sports.io/${endpoint}`, {
    headers: { "x-apisports-key": process.env.FOOTBALL_API_KEY },
    params,
  });
  return res.data.response;
}

async function getFormaReciente(teamId) {
  try {
    const data = await football("fixtures", { team: teamId, last: 5 });
    return data.map(f => ({
      rival: f.teams.home.id === teamId ? f.teams.away.name : f.teams.home.name,
      condicion: f.teams.home.id === teamId ? "Local" : "Visitante",
      marcador: `${f.goals.home}-${f.goals.away}`,
      resultado: f.teams.home.id === teamId
        ? (f.teams.home.winner ? "W" : f.teams.away.winner ? "L" : "D")
        : (f.teams.away.winner ? "W" : f.teams.home.winner ? "L" : "D"),
    }));
  } catch { return []; }
}

async function getJugadores(teamId, leagueId, season) {
  try {
    const data = await football("players", { team: teamId, league: leagueId || 262, season: season || 2025 });
    return data.map(p => ({
      nombre: p.player.name,
      posicion: p.statistics[0]?.games?.position,
      goles: p.statistics[0]?.goals?.total || 0,
      asistencias: p.statistics[0]?.goals?.assists || 0,
      rating: parseFloat(p.statistics[0]?.games?.rating) || 0,
    })).sort((a, b) => b.rating - a.rating).slice(0, 5);
  } catch { return []; }
}

// GET /fixtures-liga
app.get('/fixtures-liga', async (req, res) => {
  const { liga, season } = req.query;
  if (!liga) return res.status(400).json({ error: 'Falta liga' });
  try {
    const data = await football('fixtures', { league: liga, season: season || 2025, next: 20 });
    res.json({
      partidos: data.map(f => ({
        id: f.fixture.id, fecha: f.fixture.date,
        estadio: f.fixture.venue?.name, ciudad: f.fixture.venue?.city,
        liga: f.league.name, ligaId: f.league.id, season: f.league.season, ronda: f.league.round,
        equipo1: { nombre: f.teams.home.name, logo: f.teams.home.logo, id: f.teams.home.id },
        equipo2: { nombre: f.teams.away.name, logo: f.teams.away.logo, id: f.teams.away.id },
      }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /buscar-partido
app.get('/buscar-partido', async (req, res) => {
  const { e1, e2 } = req.query;
  if (!e1 || !e2) return res.status(400).json({ error: 'Faltan equipos' });
  try {
    const [r1, r2] = await Promise.all([football('teams', { search: e1 }), football('teams', { search: e2 })]);
    if (!r1?.length || !r2?.length) return res.json({ partidos: [], equipos: {} });
    const id1 = r1[0].team.id, id2 = r2[0].team.id;
    const prox1 = await football('fixtures', { team: id1, next: 10 }).catch(() => []);
    let partidos = prox1.filter(f => f.teams.home.id === id2 || f.teams.away.id === id2);
    if (!partidos.length) partidos = await football('fixtures/headtohead', { h2h: `${id1}-${id2}`, next: 5 }).catch(() => []);
    res.json({
      partidos: partidos.map(f => ({
        id: f.fixture.id, fecha: f.fixture.date,
        estadio: f.fixture.venue?.name, liga: f.league.name, ligaId: f.league.id,
        season: f.league.season, ronda: f.league.round,
        equipo1: { nombre: f.teams.home.name, logo: f.teams.home.logo, id: f.teams.home.id },
        equipo2: { nombre: f.teams.away.name, logo: f.teams.away.logo, id: f.teams.away.id },
      })),
      equipos: {
        e1: { id: id1, nombre: r1[0].team.name, logo: r1[0].team.logo },
        e2: { id: id2, nombre: r2[0].team.name, logo: r2[0].team.logo },
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /partidos
app.get("/partidos", async (req, res) => {
  try {
    const data = await football("fixtures", { league: 1, season: 2026, next: 20 });
    res.json({ partidos: data.map(f => ({ id: f.fixture.id, fecha: f.fixture.date, estadio: f.fixture.venue?.name, equipo1: { nombre: f.teams.home.name, logo: f.teams.home.logo, id: f.teams.home.id }, equipo2: { nombre: f.teams.away.name, logo: f.teams.away.logo, id: f.teams.away.id }, estado: f.fixture.status.short, ronda: f.league.round })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /analisis
app.post("/analisis", async (req, res) => {
  const { equipo1, equipo2, id1, id2, ligaId, season, fecha, liga, ronda, estadio, fechaPartido } = req.body;
  if (!equipo1 || !equipo2) return res.status(400).json({ error: "Faltan equipos" });

  try {
    const [formaE1, formaE2, jugadoresE1, jugadoresE2, h2h] = await Promise.all([
      id1 ? getFormaReciente(id1) : Promise.resolve([]),
      id2 ? getFormaReciente(id2) : Promise.resolve([]),
      id1 ? getJugadores(id1, ligaId, season) : Promise.resolve([]),
      id2 ? getJugadores(id2, ligaId, season) : Promise.resolve([]),
      (id1 && id2) ? football("fixtures/headtohead", { h2h: `${id1}-${id2}`, last: 6 }).catch(() => []) : Promise.resolve([]),
    ]);

    const [statsE1, statsE2] = await Promise.all([
      (id1 && ligaId && season) ? football("teams/statistics", { league: ligaId, season, team: id1 }).catch(() => null) : Promise.resolve(null),
      (id2 && ligaId && season) ? football("teams/statistics", { league: ligaId, season, team: id2 }).catch(() => null) : Promise.resolve(null),
    ]);

    const procesarStats = (s) => {
      if (!s || !s[0]) return null;
      const st = s[0];
      return { partidos_jugados: st.fixtures?.played?.total, victorias: st.fixtures?.wins?.total, empates: st.fixtures?.draws?.total, derrotas: st.fixtures?.loses?.total, goles_anotados: st.goals?.for?.total?.total, goles_recibidos: st.goals?.against?.total?.total, forma: st.form };
    };

    const historial = (Array.isArray(h2h) ? h2h : []).slice(0, 5).map(f => ({
      local: f.teams?.home?.name, visitante: f.teams?.away?.name,
      marcador: `${f.goals?.home ?? '?'}-${f.goals?.away ?? '?'}`,
      ganador: f.teams?.home?.winner ? f.teams.home.name : f.teams?.away?.winner ? f.teams.away.name : "Empate",
    }));

    const ctx = {
      partido: { equipos: `${equipo1} vs ${equipo2}`, liga: liga || "", ronda: ronda || "", fecha: fechaPartido || fecha || "", estadio: estadio || "" },
      equipo1: { nombre: equipo1, stats: procesarStats(statsE1), forma: formaE1, jugadores: jugadoresE1 },
      equipo2: { nombre: equipo2, stats: procesarStats(statsE2), forma: formaE2, jugadores: jugadoresE2 },
      h2h: historial,
    };

    const mensaje = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `Analiza el partido de futbol: ${equipo1} vs ${equipo2} (${liga || ''} ${ronda || ''}).

Datos reales del partido:
${JSON.stringify(ctx)}

Responde con el marcador ###JSON### seguido del analisis en JSON. Ejemplo:
###JSON###
{"resumen":"texto aqui","forma_reciente":{"equipo1":"texto","equipo2":"texto"},"fortalezas":{"equipo1":["a","b","c"],"equipo2":["a","b","c"]},"debilidades":{"equipo1":["a","b"],"equipo2":["a","b"]},"jugadores_clave":{"equipo1":[{"nombre":"N","razon":"R"}],"equipo2":[{"nombre":"N","razon":"R"}]},"factores_clave":["a","b","c"],"probabilidades":{"equipo1":45,"empate":25,"equipo2":30},"marcador_probable":"2-1","prediccion":"texto prediccion","nivel_confianza":72}`
      }],
    });

    const txt = mensaje.content[0].text;
    const parts = txt.split('###JSON###');
    const jsonStr = parts.length > 1 ? parts[parts.length - 1].trim() : txt.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);

    let analisis;
    try {
      analisis = JSON.parse(jsonMatch ? jsonMatch[0] : jsonStr);
    } catch {
      analisis = { prediccion: txt.slice(0, 300), probabilidades: { equipo1: 40, empate: 25, equipo2: 35 }, nivel_confianza: 60 };
    }

    res.json({ partido: `${equipo1} vs ${equipo2}`, analisis, generado: new Date().toISOString() });

  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => {
  res.json({ app: "ProfeBot", version: "3.3", plan: "PRO" });
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => console.log(`ProfeBot v3.3 corriendo en puerto ${PUERTO}`));