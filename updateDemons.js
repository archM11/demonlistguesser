const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'demons_consolidated.json');
const AREDL_URL = 'https://api.aredl.net/v2/api/aredl/levels';
const POINTERCRATE_URL = 'https://pointercrate.com/api/v2/demons/listed/';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error from ${url}`)); }
      });
    }).on('error', reject);
  });
}

async function fetchPointercrate(maxPosition = 700) {
  const allDemons = [];
  let after = 0;
  const pageSize = 100;

  while (after < maxPosition) {
    const url = `${POINTERCRATE_URL}?limit=${pageSize}${after > 0 ? `&after=${after}` : ''}`;
    try {
      const demons = await httpsGet(url);
      if (!demons || demons.length === 0) break;
      allDemons.push(...demons);
      const lastPos = demons[demons.length - 1].position;
      if (lastPos >= maxPosition || demons.length < pageSize) break;
      after = lastPos;
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error('[updateDemons] Pointercrate fetch error:', e.message);
      break;
    }
  }

  return allDemons;
}

function extractVideoId(url) {
  if (!url) return null;
  if (url.includes('youtube.com/watch?v=')) return url.split('watch?v=')[1].split('&')[0];
  if (url.includes('youtu.be/')) return url.split('youtu.be/')[1].split('?')[0];
  return null;
}

function mergeData(aredlDemons, pointercrateDemons) {
  const pcByName = {};
  for (const d of pointercrateDemons) {
    pcByName[d.name.toLowerCase()] = d;
  }

  return aredlDemons.map((demon, index) => {
    const pc = pcByName[demon.name.toLowerCase()];
    const videoUrl = pc ? pc.video || '' : '';
    const videoId = extractVideoId(videoUrl);

    return {
      id: demon.id,
      position: demon.position || index + 1,
      name: demon.name,
      requirement: pc ? pc.requirement || 100 : 100,
      video: videoUrl,
      thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '',
      publisher: pc ? {
        id: pc.publisher.id,
        name: pc.publisher.name,
        banned: pc.publisher.banned || false
      } : { id: demon.publisher_id, name: 'Unknown', banned: false },
      verifier: pc ? {
        id: pc.verifier.id,
        name: pc.verifier.name,
        banned: pc.verifier.banned || false
      } : { id: null, name: 'Unknown', banned: false },
      level_id: demon.level_id,
      points: demon.points,
      tags: demon.tags || [],
      description: demon.description || '',
      edel_enjoyment: demon.edel_enjoyment,
      gddl_tier: demon.gddl_tier
    };
  });
}

async function updateDemons() {
  console.log('[updateDemons] Starting demon list update...');

  try {
    // Fetch AREDL (all demons, public, no auth)
    console.log('[updateDemons] Fetching AREDL list...');
    const aredlDemons = await httpsGet(AREDL_URL);
    console.log(`[updateDemons] Got ${aredlDemons.length} demons from AREDL`);

    // Filter out legacy demons
    const activeDemons = aredlDemons.filter(d => !d.legacy);
    console.log(`[updateDemons] ${activeDemons.length} active (non-legacy) demons`);

    // Fetch Pointercrate (all available - currently ~673 demons with videos)
    console.log('[updateDemons] Fetching Pointercrate (all available)...');
    const pcDemons = await fetchPointercrate();
    console.log(`[updateDemons] Got ${pcDemons.length} demons from Pointercrate`);

    // Merge
    const merged = mergeData(activeDemons, pcDemons);
    merged.sort((a, b) => a.position - b.position);

    // Write to file
    fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf-8');
    console.log(`[updateDemons] Saved ${merged.length} demons to ${DATA_FILE}`);

    const withVideos = merged.filter(d => d.video).length;
    console.log(`[updateDemons] ${withVideos} demons have video URLs`);

    return merged;
  } catch (e) {
    console.error('[updateDemons] Update failed:', e.message);
    return null;
  }
}

module.exports = { updateDemons };

// Allow running standalone: node updateDemons.js
if (require.main === module) {
  updateDemons().then(result => {
    if (result) console.log('[updateDemons] Done!');
    else process.exit(1);
  });
}
