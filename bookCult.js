try { require('dotenv').config(); } catch {}
const https = require('https');
const axios = require('axios');

// ─── Config ───
const CENTER_ID = 988;           // BaddyZone HSR
const WORKOUT_ID = 350;          // Badminton
const TARGET_SLOT_ID = '15';     // 7-8 PM slot
const FALLBACK_SLOT_IDS = ['16', '15', '17', '14'];  // 8PM, 7PM, 9PM, 6PM fallbacks
const MAX_RETRIES = 15;
const RETRY_DELAY_MS = 300;

// ─── Keep-alive agent for connection reuse ───
const agent = new https.Agent({ keepAlive: true, maxSockets: 10 });

const headers = {
    'apikey': process.env.API_KEY,
    'cookie': `at=${process.env.AT}; st=${process.env.ST}`,
    'appversion': '7',
    'browsername': 'Web',
    'osname': 'browser',
    'cityid': 'Bangalore',
    'timezone': 'Asia/Kolkata',
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
};

const client = axios.create({
    baseURL: 'https://www.cult.fit/api',
    headers,
    httpsAgent: agent,
    timeout: 5000,
});

// ─── Fast book: fire POST directly with known slot ID + computed date ───
async function blindBook(date, slotId) {
    return client.post('/v2/fitso/web/class/book', {
        slotId,
        classId: slotId,
        productType: 'PLAY',
        date,
        workoutId: WORKOUT_ID,
        centerID: CENTER_ID,
    });
}

// ─── Schedule-based book: fetch schedule, find target, book ───
async function scheduleBook() {
    const resp = await client.get('/v2/fitso/web/schedule', {
        params: { workoutId: WORKOUT_ID, productType: 'PLAY', pageFrom: 'PLAY', pageType: 'slotbooking', centerId: CENTER_ID },
    });
    const dateList = resp.data?.classByDateList;
    if (!dateList?.length) throw new Error('No dates');

    const lastDay = dateList[dateList.length - 1];
    // Prefer 7PM slot, then fallbacks, then any AVAILABLE
    const target =
        lastDay.classByTimeList.find(s => s.classes[0].id === TARGET_SLOT_ID && s.classes[0].state === 'AVAILABLE') ||
        lastDay.classByTimeList.find(s => FALLBACK_SLOT_IDS.includes(s.classes[0].id) && s.classes[0].state === 'AVAILABLE') ||
        lastDay.classByTimeList.find(s => s.classes[0].state === 'AVAILABLE');

    if (!target) {
        console.log(`[schedule] No AVAILABLE slot on ${lastDay.id}`);
        return null;
    }

    const cls = target.classes[0];
    console.log(`[schedule] Booking ${cls.date} ${cls.startTime} (slot ${cls.id})`);
    return blindBook(cls.date, cls.id);
}

// ─── Compute the target date (furthest bookable = today + 3 days) ───
function getTargetDate() {
    const d = new Date();
    // Convert to IST
    const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    ist.setDate(ist.getDate() + 4);
    return ist.toISOString().split('T')[0];
}

async function main() {
    const t0 = Date.now();
    const targetDate = getTargetDate();
    console.log(`[start] Target date: ${targetDate}, slot: ${TARGET_SLOT_ID} (7-8 PM)`);

    // ─── Phase 1: Blind fire ───
    // Fire booking immediately with known slot ID — no schedule fetch needed.
    // This wins the race when slots just opened.
    try {
        console.log(`[blind] POST book ${targetDate} slot ${TARGET_SLOT_ID}...`);
        const resp = await blindBook(targetDate, TARGET_SLOT_ID);
        console.log(`[blind] BOOKED in ${Date.now() - t0}ms!`, JSON.stringify(resp.data));
        return;
    } catch (e) {
        const code = e.response?.data?.meta?.code || e.response?.status || e.message;
        console.log(`[blind] Failed: ${code} (${Date.now() - t0}ms)`);
    }

    // ─── Phase 2: Retry loop with schedule fetch ───
    for (let i = 1; i <= MAX_RETRIES; i++) {
        const elapsed = Date.now() - t0;
        console.log(`[retry ${i}/${MAX_RETRIES}] ${elapsed}ms elapsed`);

        try {
            const resp = await scheduleBook();
            if (resp) {
                console.log(`[retry] BOOKED in ${Date.now() - t0}ms!`, JSON.stringify(resp.data));
                return;
            }
        } catch (e) {
            const code = e.response?.data?.meta?.code || e.response?.status || e.message;
            console.log(`[retry] Failed: ${code}`);
        }

        if (i < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }

    // ─── Phase 3: Carpet bomb all evening slots ───
    console.log(`[carpet] Trying all fallback slots...`);
    const results = await Promise.allSettled(
        FALLBACK_SLOT_IDS.map(id => blindBook(targetDate, id))
    );
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
            console.log(`[carpet] BOOKED slot ${FALLBACK_SLOT_IDS[i]} in ${Date.now() - t0}ms!`);
            console.log(JSON.stringify(results[i].value.data));
            return;
        }
    }

    console.log(`[done] All attempts failed after ${Date.now() - t0}ms`);
}

// ─── Warm up TCP + TLS connection before 9 PM ───
async function warmUp() {
    try {
        await client.get('/user/cities/v2');
        console.log('[warmup] Connection pool ready');
    } catch {}
}

warmUp().then(() => main());
