const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// =========================================================================================
// 1. CẤU HÌNH API (TUANX3000 - V5)
// =========================================================================================
const API_CONFIG = {
    NOHU: 'https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=1b976f07877db7991b1a94f8f1b44bb0',
    MD5: 'https://wtxmd52.macminim6.online/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=1b976f07877db7991b1a94f8f1b44bb0'
};

let APP_STATE = {
    nohu: { history: [], lastPred: null, stats: { win: 0, loss: 0, total: 0 }, processed: new Set() },
    md5:  { history: [], lastPred: null, stats: { win: 0, loss: 0, total: 0 }, processed: new Set() }
};

// =========================================================================================
// 2. THUẬT TOÁN SOI CẦU (Giữ nguyên V4)
// =========================================================================================
class SmartPredictor {
    predict(history) {
        if (!history || history.length === 0) {
            return { 
                ketqua: Math.random() > 0.5 ? 'Tài' : 'Xỉu', 
                confidence: '50%', 
                logic: 'Đang đợi dữ liệu API...' 
            };
        }

        const results = history.map(h => h.result);
        const last = results[results.length - 1];
        let chain = 0;
        for (let i = results.length - 1; i >= 0; i--) {
            if (results[i] === last) chain++;
            else break;
        }

        if (chain >= 6) {
            return { ketqua: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: '85%', logic: 'Bẻ cầu (Hết biên)' };
        }
        if (chain >= 2) {
            return { ketqua: last, confidence: '75%', logic: `Bám bệt (${chain} tay)` };
        }
        if (results.length >= 2 && results[results.length - 1] !== results[results.length - 2]) {
            return { ketqua: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: '80%', logic: 'Bám cầu 1-1' };
        }

        return { ketqua: last === 'Tài' ? 'Xỉu' : 'Tài', confidence: '60%', logic: 'Cầu đảo' };
    }
}

const predictor = new SmartPredictor();

// =========================================================================================
// 3. ĐỒNG BỘ DỮ LIỆU (SỬA ĐỂ KHỚP API MỚI - V5)
// =========================================================================================
async function syncGameData(type) {
    try {
        const url = API_CONFIG[type.toUpperCase()];
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.31 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.31',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const rawList = await response.json();   // ← API trả về array trực tiếp

        if (!Array.isArray(rawList) || rawList.length === 0) {
            console.log(`[TUANX3000-V5] ${type} → Không có dữ liệu`);
            return;
        }

        const state = APP_STATE[type];

        const newHistory = rawList.map(item => {
            const sum = Number(item.DiceSum || 0);
            let finalRes = 'Xỉu';
            if (sum >= 11 && sum <= 17) {
                finalRes = 'Tài';
            } else if (sum >= 4 && sum <= 10) {
                finalRes = 'Xỉu';
            }
            // Nếu là bộ ba giống nhau (tùy game) vẫn để Xỉu/Tài theo sum, tool sẽ soi theo lịch sử

            return {
                session: Number(item.SessionId || 0),
                result: finalRes
            };
        }).filter(h => h.session > 0).reverse();   // cũ -> mới

        if (newHistory.length === 0) return;

        const latest = newHistory[newHistory.length - 1];

        // Tính thắng thua
        if (state.lastPred && state.lastPred.phien === latest.session && !state.processed.has(latest.session)) {
            state.stats.total++;
            if (state.lastPred.ketqua === latest.result) state.stats.win++;
            else state.stats.loss++;
            state.processed.add(latest.session);
            if (state.processed.size > 100) state.processed.delete([...state.processed][0]);
        }

        state.history = newHistory;
        console.log(`[TUANX3000-V5] ${type} → Đồng bộ thành công ${newHistory.length} phiên`);

    } catch (e) {
        console.log(`[TUANX3000-V5-ERROR] ${type}:`, e.message);
    }
}

// Sync mỗi 5 giây
setInterval(() => {
    syncGameData('nohu');
    syncGameData('md5');
}, 5000);

// =========================================================================================
// 4. OUTPUT JSON
// =========================================================================================
app.get('/', (req, res) => {
    try {
        const build = (type) => {
            const s = APP_STATE[type];
            const lastSession = s.history.length > 0 ? s.history[s.history.length - 1].session : 0;
            const nextId = lastSession + 1;

            if (!s.lastPred || s.lastPred.phien !== nextId) {
                const p = predictor.predict(s.history);
                s.lastPred = { phien: nextId, ketqua: p.ketqua, confidence: p.confidence, logic: p.logic };
            }

            return {
                phien_tiep: nextId,
                du_doan: s.lastPred.ketqua,
                tin_cay: s.lastPred.confidence,
                logic: s.lastPred.logic,
                lich_su_gan_nhat: s.history.slice(-12).map(h => h.result).join(' - '),
                thong_ke: {
                    thang: s.stats.win,
                    thua: s.stats.loss,
                    winrate: s.stats.total > 0 ? ((s.stats.win / s.stats.total) * 100).toFixed(1) + "%" : "0%"
                }
            };
        };

        res.json({
            system: "TX-PREDICTOR-V5-FINAL",
            admin: "TUANX3000",
            update_at: new Date().toLocaleString('vi-VN'),
            nohu: build('nohu'),
            md5: build('md5')
        });
    } catch (err) {
        console.error('[TUANX3000-V5] Error:', err);
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/reset', (req, res) => {
    Object.keys(APP_STATE).forEach(k => {
        APP_STATE[k].stats = { win: 0, loss: 0, total: 0 };
        APP_STATE[k].processed.clear();
    });
    res.json({ message: "Đã reset thống kê - V5" });
});

app.listen(PORT, () => {
    console.log(`🚀 TUANX3000: TX-PREDICTOR-V5 ONLINE PORT ${PORT}`);
    syncGameData('nohu');
    syncGameData('md5');
});