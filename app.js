let isNotifyActive = false;

// #region agent log
fetch('http://127.0.0.1:7752/ingest/a1d91d84-c820-4342-a6a3-afa592b75903',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'75c846'},body:JSON.stringify({sessionId:'75c846',runId:'pre-fix',hypothesisId:'H6',location:'app.js:top-level',message:'script parsed and executed',data:{href:location.href, readyState:document.readyState},timestamp:Date.now()})}).catch(()=>{});
// #endregion

window.addEventListener('error', (evt) => {
    // #region agent log
    fetch('http://127.0.0.1:7752/ingest/a1d91d84-c820-4342-a6a3-afa592b75903',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'75c846'},body:JSON.stringify({sessionId:'75c846',runId:'pre-fix',hypothesisId:'H7',location:'app.js:window.onerror',message:'runtime error captured',data:{message:evt?.message,file:evt?.filename,line:evt?.lineno,col:evt?.colno},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
});

// Helper: Escape HTML to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Helper: Generate unique document ID (collision-safe)
function generateDocId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const App = {
    inventory: [],
    currentFilter: 'all',
    searchTerm: '',
    allStockSearchTerm: '', // Added Phase 3
    allStockFilter: 'all',  // Added Phase 3
    notifications: [],
    toastTimeout: null,
    apiKeys: [],
    currentKeyIndex: 0,
    currentMode: 'inbound', // Default mode
    viewMode: localStorage.getItem('cafe_view_mode') || 'list', // Added Zoom/View Switcher
    gridZoomSize: parseInt(localStorage.getItem('cafe_grid_zoom')) || 100, // Phase 2 Zoom

    debugLog(runId, hypothesisId, location, message, data = {}) {
        // #region agent log
        fetch('http://127.0.0.1:7752/ingest/a1d91d84-c820-4342-a6a3-afa592b75903',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'75c846'},body:JSON.stringify({sessionId:'75c846',runId,hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
        // #endregion
    },

    loadApiKeys() {
        // ล้าง key เก่าใน localStorage เพื่อป้องกัน key ผิดค้างอยู่
        localStorage.removeItem('gemini_api_keys');
        localStorage.removeItem('gemini_api_key');
        
        this.apiKeys = [
            'AIzaSyAHFMhA1ZGmy2o_S0uZzgA8qwB1V4vx9V4',
            'AIzaSyCmQILt-_PQfHh46vGmZrYnQDwjNatizE0',
            'AIzaSyCKaqEw_mXRt9RCAAfpP2uoPx0xoKZNJjs',
            'AIzaSyC2UMTeLlhX_kPAuxjZSdo6l5oWp3xJBM4'
        ];
    },

    async loadInventory() { return this.loadData(); },
    loadData() {
        if (typeof db === 'undefined') {
            console.error("Firebase DB is not initialized. Check internet connection or CDN.");
            this.showToast("ระบบออฟไลน์: ไม่สามารถเชื่อมต่อฐานข้อมูลได้", "text-red-500");
            this.refreshUI(); // Render empty UI instead of crashing
            return;
        }
        if (this.unsubscribe) this.unsubscribe(); // Avoid multiple listeners

        this.unsubscribe = db.collection('items').onSnapshot(snapshot => {
            console.log("🔥 Firestore Update Received");
            this.inventory = [];
            const now = new Date();
            
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.is_archived === 1) return;

                let expiry = data.expiry_date || data.expiryISO || null;

                // Handle backward compatibility for is_opened (0/1) vs isOpened (boolean)
                const isOpened = data.isOpened === true || data.is_opened === 1;

                this.inventory.push({
                    ...data,
                    id: doc.id,
                    expiryISO: expiry,
                    isOpened: isOpened,
                    is_opened: isOpened ? 1 : 0 // Keep old field for internal compatibility if needed
                });
            });

            // Trigger re-renders based on which page we are on
            this.refreshUI();
        }, error => {
            console.error("Firestore Subscription Error:", error);
            App.showToast("การเชื่อมต่อฐานข้อมูลขัดข้อง", 'text-red-400');
        });
    },

    refreshUI() {
        if (document.getElementById('inventoryList')) this.renderList();
        if (document.getElementById('allStockContainer')) this.renderAllStock();
        if (document.getElementById('summaryTextPreview')) this.renderSummary();
        
        // Re-calculate notification indicators if any
        if (document.getElementById('btnNotify')) this.checkNotificationStatus();
        
        // Update Dashboard if on home page
        if (document.getElementById('executiveDashboard')) this.renderDashboard();

        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },


    async callGemini(prompt, base64Image = null) {
        if (this.apiKeys.length === 0) this.loadApiKeys();
        if (this.apiKeys.length === 0) throw new Error("Missing API Key");

        let attempts = 0;
        const maxAttempts = this.apiKeys.length;

        while (attempts < maxAttempts) {
            const apiKey = this.apiKeys[this.currentKeyIndex];
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
            
            const payload = {
                contents: [{
                    parts: [{ text: prompt }]
                }]
            };

            if (base64Image) {
                payload.contents[0].parts.push({
                    inline_data: {
                        mime_type: "image/jpeg",
                        data: base64Image
                    }
                });
            }

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res.status === 429) {
                    console.warn(`Key ${this.currentKeyIndex} rate limited (429). Rotating...`);
                    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
                    attempts++;
                    if (this.apiKeys.length > 1) {
                        App.showToast("⚠️ สลับใช้ API Key สำรอง...", 'text-amber-400');
                    }
                    continue;
                }

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error?.message || "AI Call Failed");
                }

                return await res.json();
            } catch (e) {
                if (attempts >= maxAttempts - 1) throw e;
                console.error("Retry attempt failed:", e);
                this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
                attempts++;
            }
        }
        throw new Error("All API keys exhausted");
    },

    itemToDelete: null,

    async init() {
        try {
        this.debugLog('pre-fix', 'H4', 'app.js:init:start', 'init entered', {
            path: window.location.pathname,
            hasInventoryList: !!document.getElementById('inventoryList'),
            hasQuickAdd: !!document.getElementById('q_itemName'),
            hasAddForm: !!document.getElementById('n_expiryDate')
        });
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
        if (document.getElementById('headerDate')) this.updateHeaderDate();

        await this.loadData();

        if (document.getElementById('inventoryList')) this.renderList();
        if (document.getElementById('btnNotify')) this.checkNotificationStatus();

        if (document.getElementById('n_expiryDate')) {
            this.initAddForm();
            const params = new URLSearchParams(window.location.search);
            if (params.get('camera') === 'true') {
                setTimeout(() => this.openCamera(), 300);
            }
        }
        if (document.getElementById('q_itemName')) this.initQuickAdd();
        if (document.getElementById('summaryTextPreview')) {
            this.initSummary();
        }

        if (document.getElementById('allStockContainer')) {
            this.initAllStock();
        }

        this.updateViewModeUI(); // Ensure UI matches state
        this.applyZoom(); // Apply initial zoom

        // Quick Add Listeners
        // if (this.inventory.length === 0 && document.getElementById('inventoryList')) this.addDemoData();

        setInterval(() => this.backgroundCheck(), 60000);

        // Active Mode logic
        this.setMode(this.currentMode);
        this.debugLog('pre-fix', 'H4', 'app.js:init:end', 'init completed', {
            inventoryCount: this.inventory.length,
            mode: this.currentMode
        });
        } catch(error) {
            console.error("App Initialization Error:", error);
            this.debugLog('pre-fix', 'H4', 'app.js:init:catch', 'init failed', { name: error?.name, message: error?.message });
            if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
        }
    },

    async handleOpenItem(itemId) {
        const item = this.inventory.find(i => i.id === itemId);
        if (!item) return;

        if (!confirm(`ยืนยันการเปิดใช้งาน "${item.name}"? (ระบบจะเริ่มนับถอยหลังความสด)`)) return;

        const now = new Date();
        const freshnessMap = {
            'นม/ของเหลว': 3,
            'เบเกอรี่': 2,
            'กาแฟ/ชา': 30,
            'ไซรัป/ผง': 30,
            'อื่นๆ': 7
        };
        
        const daysToAdd = freshnessMap[item.category] || 7;
        const freshnessExpiry = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);

        try {
            const batch = db.batch();
            
            if (parseFloat(item.quantity) > 1) {
                // Split: Reduce quantity of current item
                const itemRef = db.collection('items').doc(itemId);
                batch.update(itemRef, {
                    quantity: parseFloat(item.quantity) - 1,
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                });

                // Create new opened item
                const newRef = db.collection('items').doc();
                batch.set(newRef, {
                    ...item,
                    id: newRef.id,
                    quantity: 1,
                    isOpened: true,
                    is_opened: 1,
                    openedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    freshnessExpiry: freshnessExpiry.toISOString(),
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Just update current item
                const itemRef = db.collection('items').doc(itemId);
                batch.update(itemRef, {
                    isOpened: true,
                    is_opened: 1,
                    openedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    freshnessExpiry: freshnessExpiry.toISOString(),
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            await batch.commit();
            App.showToast(`✨ เปิดใช้งาน ${item.name} แล้ว! ไปที่หน้าหลักเพื่อดูความสด`, 'text-emerald-400');
        } catch (e) {
            console.error("Handle Open Error:", e);
            App.showToast("เกิดข้อผิดพลาดในการเปิดสินค้า", 'text-red-400');
        }
    },


    showToast(message, iconColorClass = 'text-amber-400', isUrgent = false, title = null) {
        const toast = document.getElementById('toastMsg');
        const toastText = document.getElementById('toastText');
        const toastIcon = document.getElementById('toastIcon');
        const toastTitle = document.getElementById('toastTitle');
        this.debugLog('pre-fix', 'H2', 'app.js:showToast:elements', 'toast elements resolved', {
            hasToast: !!toast,
            hasToastText: !!toastText,
            hasToastIcon: !!toastIcon,
            hasToastTitle: !!toastTitle,
            isUrgent
        });

        toastText.innerHTML = message;
        toastIcon.className = `w-6 h-6 shrink-0 ${iconColorClass}`;

        if (title) { toastTitle.textContent = title; toastTitle.classList.remove('hidden'); }
        else { toastTitle.classList.add('hidden'); }

        if (isUrgent) {
            toast.className = "fixed top-16 left-1/2 -translate-x-1/2 bg-red-600 border-2 border-red-400 text-white px-5 py-3 rounded-2xl shadow-[0_10px_40px_-10px_rgba(220,38,38,0.7)] z-[200] transition-all duration-500 flex items-center gap-3 w-[90%] max-w-sm text-sm font-medium opacity-100 translate-y-0";
            toastIcon.className = "w-6 h-6 shrink-0 text-white animate-bounce";
        } else {
            toast.className = "fixed top-16 left-1/2 -translate-x-1/2 bg-stone-800 text-white px-5 py-3 rounded-2xl shadow-2xl z-[200] transition-all duration-500 flex items-center gap-3 w-[90%] max-w-sm text-sm font-medium opacity-100 translate-y-0";
        }

        if (App.toastTimeout) clearTimeout(App.toastTimeout);
        App.toastTimeout = setTimeout(() => {
            toast.classList.remove('opacity-100', 'translate-y-0', 'pointer-events-auto');
            toast.classList.add('opacity-0', '-translate-y-10', 'pointer-events-none');
        }, isUrgent ? 7000 : 4000);
    },

    async addDemoData() {
        const now = new Date();
        const date1 = new Date(now); date1.setHours(now.getHours() + 5);
        const date2 = new Date(now); date2.setHours(now.getHours() - 1);
        const date3 = new Date(now); date3.setDate(now.getDate() + 3);

        const demos = [
            { id: 1, name: "วิปครีม (ผสมเช้านี้)", expiryISO: date1.toISOString(), source: "quick", notifiedLevel: 'none' },
            { id: 2, name: "นมพาสเจอร์ไรซ์ (ขวดเก่า)", expiryISO: date2.toISOString(), source: "manual", notifiedLevel: 'none' },
            { id: 3, name: "เมล็ดกาแฟ House Blend", expiryISO: date3.toISOString(), source: "quick", notifiedLevel: 'none' }
        ];
        for (let d of demos) {
            try {
                const docId = Date.now().toString() + Math.random().toString().slice(2, 5);
                await db.collection('items').doc(docId).set({
                    ...d,
                    expiry_date: d.expiryISO,
                    quantity: 1,
                    is_opened: 0,
                    category: "นม/ของเหลว"
                });
            } catch (e) { console.error("Demo data failed", e); }
        }
        await this.loadInventory();
        this.renderList();
    },

    updateHeaderDate() {
        const now = new Date();
        document.getElementById('headerDate').textContent = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short' });
    },

    // ==========================================
    // ระบบกล้องสแกน (WebRTC)
    // ==========================================
    cameraStream: null,

    async openCamera() {
        try {
            const overlay = document.getElementById('cameraOverlay');
            const video = document.getElementById('cameraVideo');
            if (!overlay || !video) return;

            overlay.classList.remove('hidden');

            this.cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" }
            });
            video.srcObject = this.cameraStream;
            if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
        } catch (err) {
            console.error("Camera error:", err);
            this.showToast("ไม่สามารถเข้าถึงกล้องได้ กรุณาใช้ปุ่มอัปโหลดรูปภาพ", "text-red-400");
            this.closeCamera();
        }
    },

    closeCamera() {
        const overlay = document.getElementById('cameraOverlay');
        if (overlay) overlay.classList.add('hidden');

        if (this.cameraStream) {
            this.cameraStream.getTracks().forEach(track => track.stop());
            this.cameraStream = null;
        }
    },

    async capturePhoto() {
        const video = document.getElementById('cameraVideo');
        const canvas = document.getElementById('cameraCanvas');
        if (!this.cameraStream || !video || !canvas) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);

        this.closeCamera();

        canvas.toBlob((blob) => {
            const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
            this.handleGeminiScan({ files: [file], value: '' });
        }, 'image/jpeg', 0.8);
    },

    // ==========================================
    // ระบบคิว AI Background Processing
    // ==========================================
    AiQueue: {
        queue: [],
        isProcessing: false,
        totalInCurrentBatch: 0,
        completedInCurrentBatch: 0,
        
        addJob(jobFn) {
            this.queue.push(jobFn);
            if (this.totalInCurrentBatch === 0) {
                this.totalInCurrentBatch = this.queue.length;
            } else {
                this.totalInCurrentBatch++;
            }
            this.updateStatus();
            this.processNext();
        },
        
        async processNext() {
            if (this.isProcessing || this.queue.length === 0) return;
            
            this.isProcessing = true;
            const job = this.queue.shift();
            
            try {
                await job();
            } catch (err) {
                console.error("AI Job Error:", err);
                App.showToast("ระบบสแกนขัดข้อง กรุณาลองอีกครั้ง", 'text-red-400', true);
            }
            
            this.completedInCurrentBatch++;
            this.updateStatus();
            
            this.isProcessing = false;
            
            // Add a small delay between requests to be extra safe with Rate Limits
            setTimeout(() => {
                if (this.queue.length > 0) {
                    this.processNext();
                } else {
                    // Reset batch counters when empty
                    this.totalInCurrentBatch = 0;
                    this.completedInCurrentBatch = 0;
                    setTimeout(() => {
                        const toast = document.getElementById('toastMsg');
                        if (toast && toast.classList.contains('ai-queue-toast')) {
                            toast.classList.remove('opacity-100', 'translate-y-0');
                            toast.classList.add('opacity-0', '-translate-y-10');
                            toast.classList.remove('ai-queue-toast');
                        }
                    }, 2000);
                }
            }, 500);
        },
        
        updateStatus() {
            const badge = document.getElementById('aiQueueBadge');
            const countText = document.getElementById('aiQueueCount');
            App.debugLog('pre-fix', 'H3', 'app.js:AiQueue:updateStatus', 'queue status update', {
                totalInBatch: this.totalInCurrentBatch,
                queueLength: this.queue.length,
                hasBadge: !!badge,
                hasCountText: !!countText,
                hasToastMsg: !!document.getElementById('toastMsg')
            });

            if (this.totalInCurrentBatch > 0) {
                const remaining = this.queue.length;
                
                // Update badge
                if (badge && countText) {
                    if (remaining > 0) {
                        badge.classList.remove('hidden');
                        badge.classList.add('flex');
                        countText.textContent = remaining;
                    } else {
                        badge.classList.add('hidden');
                        badge.classList.remove('flex');
                    }
                }

                if (remaining > 0) {
                    App.showToast(`🤖 กำลังให้ AI ช่วยดู... เหลืออีก ${remaining} คิว`, "text-blue-400", false, "AI Background Scan");
                    document.getElementById('toastMsg').classList.add('ai-queue-toast');
                } else {
                    App.showToast(`✨ ประมวลผลเสร็จสิ้น!`, "text-green-400", false, "AI Background Scan");
                }
            }
        }
    },

    // ==========================================
    // ระบบสแกนด้วย Gemini AI (แม่นยำขั้นสุด)
    // ==========================================

    // ย่อรูปก่อนส่งให้ AI ช่วยลดเน็ตและประมวลผลเร็วขึ้น
    // และใช้ย่อรูปสำหรับเก็บเป็น Thumbnail
    compressImageToBase64(file, fastMode = false, maxWidth = null) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    const targetWidth = maxWidth || (fastMode ? 450 : 800);
                    if (width > targetWidth) {
                        height = (targetWidth / width) * height;
                        width = targetWidth;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // หากเป็น Thumbnail ให้ใช้คุณภาพต่ำลงอีกเพื่อประหยัดพื้นที่
                    const quality = maxWidth ? 0.5 : (fastMode ? 0.6 : 0.8);
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    
                    if (maxWidth) {
                        resolve(dataUrl); // Return full DataURL for thumbnail
                    } else {
                        resolve(dataUrl.split(',')[1]); // Return only Base64 for Gemini
                    }
                };
                img.src = event.target.result;
            };
            reader.onerror = e => reject(e);
        });
    },

    // ฟังก์ชันหลักดึงภาพส่งให้ Gemini
    async handleGeminiScan(input, isFromDashboard = false) {
        if (!input.files || !input.files[0]) return;

        const file = input.files[0];
        
        // Show an initial brief overlay, but AiQueue will handle the rest
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            this.updateOcrProgress("กำลังย่อรูปภาพให้ประมวลผลเร็วขึ้น...");
        }

        try {
            // 1. เตรียมรูปภาพ: ตัวหลักสำหรับ AI และ Thumbnail สำหรับ UI
            const base64ForAi = await this.compressImageToBase64(file, true);
            const thumbData = await this.compressImageToBase64(file, false, 120);

            this.AiQueue.addJob(async () => {
                this.updateOcrProgress("กำลังด่วน! แกะข้อความ... (ไม่เกิน 15 วินาที)");
                const prompt = `คุณคือ AI ผู้ช่วยร้านกาแฟ สแกนฉลากสินค้าในภาพนี้
สินค้าที่พบมักจะเป็น: นม, ครีม, วิปครีม, กาแฟ, ชา, ไซรัป, น้ำผลไม้, แยม, ซอส, เบเกอรี่, แป้ง, น้ำตาล ฯลฯ
ให้ดึงข้อมูลดังนี้:
1. ชื่อสินค้า (name) - ภาษาไทยถ้าเป็นไปได้
2. ยี่ห้อ (brand) - เช่น ตราหมี, เมจิ, เนสท์เล่
3. ขนาด (size) - เช่น 1 ลิตร, 500ml, 200g
4. ราคา (price) - ตัวเลข ถ้าไม่มีใส่ 0
5. วันหมดอายุ (expiryDate) - รูปแบบ ISO เช่น 2025-12-31
ตอบเป็น JSON เท่านั้น: {"name":"ชื่อ","brand":"ยี่ห้อ","size":"ขนาด","price":0,"expiryDate":"YYYY-MM-DD"}`;

                // ⏱ Timeout 20 วินาที — ถ้า AI นานเกิน จะเปิดฟอร์มให้กรอกเอง
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("TIMEOUT")), 20000)
                );

                let data = null;
                try {
                    const responseJson = await Promise.race([
                        App.callGemini(prompt, base64ForAi),
                        timeoutPromise
                    ]);

                    console.log("✅ Gemini Raw Response:", responseJson);
                    
                    if (responseJson && responseJson.candidates && responseJson.candidates[0]) {
                        let textResult = responseJson.candidates[0]?.content?.parts?.[0]?.text;
                        console.log("📝 AI Text Result:", textResult);
                        if (textResult) {
                            const jsonMatch = textResult.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
                            if (jsonMatch) {
                                data = JSON.parse(jsonMatch[0]);
                                console.log("📦 Parsed Data:", data);
                            } else {
                                console.warn("⚠️ ไม่พบ JSON ใน AI response");
                            }
                        }
                    } else {
                        console.warn("⚠️ Response ไม่มี candidates:", responseJson);
                    }
                } catch (aiErr) {
                    if (aiErr.message === "TIMEOUT") {
                        console.warn("⏱ AI Scan Timeout — เปิดฟอร์มให้กรอกเอง");
                        App.showToast("⏱ AI ใช้เวลานาน เปิดฟอร์มให้กรอกเองครับ", "text-amber-400");
                    } else {
                        console.error("❌ AI Scan Error:", aiErr);
                        App.showToast("⚠️ AI สแกนไม่สำเร็จ เปิดฟอร์มให้กรอกเองครับ", "text-amber-400");
                    }
                }

                // แสดงฟอร์มทุกกรณี
                console.log("🎯 Final data for form:", data);
                const items = [{
                    name: data?.name || "",
                    brand: data?.brand || "",
                    size: data?.size || "",
                    quantity: 1,
                    unit: "ชิ้น",
                    price: data?.price || 0,
                    expiryDate: data?.expiryDate || "",
                    image_url: thumbData
                }];
                console.log("📋 Items sent to review form:", items);

                if (overlay) overlay.classList.add('hidden');
                App.renderReceiptReview(items);
                
                if (data?.name) {
                    App.showToast("✨ AI สแกนสำเร็จ! ตรวจสอบข้อมูลก่อนบันทึก", "text-green-400");
                }
            });

        } catch (error) {
            console.error("Gemini Image Prep Error: ", error);
            this.showToast("ไม่สามารถประมวลผลรูปภาพได้", 'text-red-400');
            // แม้เตรียมรูปพัง ก็เปิดฟอร์มว่างให้กรอกเอง
            if (overlay) overlay.classList.add('hidden');
            App.renderReceiptReview([{ name: "", quantity: 1, unit: "ชิ้น", price: 0, expiryDate: "" }]);
        } finally {
            if (input) input.value = '';
        }
    },

    async handleReceiptScan(input) {
        if (!input.files || !input.files[0]) return;

        const file = input.files[0];
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.classList.remove('hidden');

        try {
            const base64Data = await this.compressImageToBase64(file, true);
            
            this.AiQueue.addJob(async () => {
                this.updateOcrProgress("กำลังด่วน! สรุปรายการบิล... (ไม่เกิน 15 วินาที)");
                const prompt = `คุณคือ AI ผู้ช่วยร้านกาแฟ สแกนใบเสร็จ/บิลในภาพนี้
สินค้าที่พบมักจะเป็น: นม, ครีม, กาแฟ, ชา, ไซรัป, น้ำผลไม้, เบเกอรี่, แป้ง, น้ำตาล ฯลฯ
ดึงรายการสินค้าทั้งหมด ตอบเป็น JSON Array:
[{"name":"ชื่อ","brand":"ยี่ห้อ","size":"ขนาด","quantity":1,"unit":"ชิ้น","price":0,"expiryDate":"YYYY-MM-DD"}]`;

                // ⏱ Timeout 15 วินาที
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("TIMEOUT")), 15000)
                );

                let items = null;
                try {
                    const responseJson = await Promise.race([
                        App.callGemini(prompt, base64Data),
                        timeoutPromise
                    ]);
                    console.log("Receipt Raw Response:", responseJson);
                    
                    if (responseJson && responseJson.candidates && responseJson.candidates[0]) {
                        let textResult = responseJson.candidates[0]?.content?.parts?.[0]?.text;
                        if (textResult) {
                            const jsonMatch = textResult.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
                            if (jsonMatch) {
                                const parsed = JSON.parse(jsonMatch[0]);
                                items = Array.isArray(parsed) ? parsed : [parsed];
                            }
                        }
                    }
                } catch (aiErr) {
                    if (aiErr.message === "TIMEOUT") {
                        console.warn("⏱ Receipt Scan Timeout — เปิดฟอร์มให้กรอกเอง");
                        App.showToast("⏱ AI ใช้เวลานาน เปิดฟอร์มให้กรอกเองครับ", "text-amber-400");
                    } else {
                        console.error("Receipt Scan Error:", aiErr);
                        App.showToast("⚠️ สแกนบิลไม่สำเร็จ เปิดฟอร์มให้กรอกเองครับ", "text-amber-400");
                    }
                }

                if (overlay) overlay.classList.add('hidden');
                
                // เปิดฟอร์มทุกกรณี — ถ้ามีข้อมูลก็ใส่ให้, ไม่มีก็เปิดว่าง 1 รายการ
                if (items && items.length > 0) {
                    App.renderReceiptReview(items);
                    App.showToast(`✨ AI พบ ${items.length} รายการ! ตรวจสอบก่อนบันทึก`, "text-green-400");
                } else {
                    App.renderReceiptReview([{ name: "", quantity: 1, unit: "ชิ้น", price: 0, expiryDate: "" }]);
                }
            });
        } catch (e) {
            console.error("Gemini Error:", e);
            this.showToast("สแกนไม่สำเร็จ เปิดฟอร์มให้กรอกเอง", 'text-amber-400');
            if (overlay) overlay.classList.add('hidden');
            App.renderReceiptReview([{ name: "", quantity: 1, unit: "ชิ้น", price: 0, expiryDate: "" }]);
        } finally {
            input.value = '';
        }
    },

    openManualBatch() {
        this.tempReceiptItems = [];
        this.addBlankTempItem();
        const modal = document.getElementById('receiptReviewModal');
        if (modal) modal.classList.remove('hidden');
    },

    addBlankTempItem() {
        this.tempReceiptItems.push({
            id: Date.now() + Math.random(),
            name: "",
            quantity: 1,
            unit: "ชิ้น",
            price: 0,
            category: "อื่นๆ",
            expiryISO: new Date(Date.now() + 7 * 24 * 3600000).toISOString().slice(0, 16)
        });
        const countTxt = document.getElementById('receiptCountText');
        if (countTxt) countTxt.textContent = `พบทั้งหมด ${this.tempReceiptItems.length} รายการ`;
        this.updateReceiptReviewList();
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    tempReceiptItems: [],
    renderReceiptReview(items) {
        this.tempReceiptItems = items.map(i => ({
            id: Date.now() + Math.random(),
            name: i.name,
            brand: i.brand || '',
            size: i.size || '',
            quantity: i.quantity || 1,
            unit: i.unit || 'ชิ้น',
            price: i.price || 0,
            category: i.category || 'อื่นๆ',
            image_url: i.image_url || '',
            expiryISO: i.expiryDate || new Date(Date.now() + 7 * 24 * 3600000).toISOString().slice(0, 16)
        }));
        
        const modal = document.getElementById('receiptReviewModal');
        if (!modal) return;
        
        const countTxt = document.getElementById('receiptCountText');
        if (countTxt) countTxt.textContent = `พบทั้งหมด ${this.tempReceiptItems.length} รายการ`;
        this.updateReceiptReviewList();
        modal.classList.remove('hidden');
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    updateReceiptReviewList() {
        // Handle different IDs between index.html and add.html
        const list = document.getElementById('itemsReviewList') || document.getElementById('receiptReviewList');
        if (!list) return;

        if (this.tempReceiptItems.length === 0) {
            list.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 text-stone-400">
                    <i data-lucide="package-open" class="w-16 h-16 mb-4 opacity-20"></i>
                    <p class="font-bold">ไม่มีรายการเหลืออยู่</p>
                </div>
            `;
            if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
            return;
        }

        list.innerHTML = this.tempReceiptItems.map((item, index) => `
            <div class="bg-white p-5 rounded-3xl shadow-sm border border-amber-200 review-card flex flex-col gap-4 relative overflow-hidden">
                <div class="absolute top-0 right-0 bg-amber-100 text-amber-700 text-[10px] font-black px-3 py-1 rounded-bl-xl flex items-center gap-1 shadow-sm">
                    <i data-lucide="sparkles" class="w-3 h-3"></i> AI อ่านข้อมูล
                </div>
                <div class="flex justify-between items-start gap-4">
                    <div class="flex-1" style="min-width:0">
                        <label class="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1 block">ชื่อสินค้า</label>
                        <input type="text" value="${item.name}" 
                            oninput="App.updateTempItem(${index}, 'name', this.value)" 
                            class="w-full bg-stone-50 border-none rounded-xl px-3 py-2 text-sm font-bold text-stone-800 focus:ring-2 focus:ring-indigo-100 outline-none transition-all">
                    </div>
                    <button onclick="App.removeTempItem(${index})" class="p-2 bg-red-50 text-red-400 hover:bg-red-100 rounded-xl transition-all mt-5">
                        <i data-lucide="trash-2" class="w-5 h-5"></i>
                    </button>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1 block">ยี่ห้อ</label>
                        <input type="text" value="${item.brand || ''}" 
                            oninput="App.updateTempItem(${index}, 'brand', this.value)"
                            placeholder="เช่น ตราหมี, เมจิ"
                            class="w-full bg-stone-50 border-none rounded-xl px-3 py-2 text-xs font-medium text-stone-600 focus:ring-2 focus:ring-indigo-100 outline-none transition-all">
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1 block">ขนาด</label>
                        <input type="text" value="${item.size || ''}" 
                            oninput="App.updateTempItem(${index}, 'size', this.value)"
                            placeholder="เช่น 1 ลิตร, 500ml"
                            class="w-full bg-stone-50 border-none rounded-xl px-3 py-2 text-xs font-medium text-stone-600 focus:ring-2 focus:ring-indigo-100 outline-none transition-all">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1 block">วันหมดอายุ (EXP)</label>
                        <input type="datetime-local" value="${item.expiryISO}" 
                            id="expiry_${index}"
                            oninput="App.updateTempItem(${index}, 'expiryISO', this.value)"
                            class="w-full bg-stone-50 border-none rounded-xl px-3 py-2 text-xs font-medium text-stone-600 focus:ring-2 focus:ring-indigo-100 outline-none transition-all">
                        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
                            ${[1,2,3,5,7,14,30].map(d => `<button type="button" onclick="App.setQuickExpiry(${index}, ${d})" style="font-size:13px;font-weight:700;padding:8px 14px;border-radius:12px;border:1.5px solid #c7d2fe;background:#eef2ff;color:#4f46e5;cursor:pointer;transition:all 0.15s" onmouseover="this.style.background='#6366f1';this.style.color='#fff';this.style.borderColor='#6366f1'" onmouseout="this.style.background='#eef2ff';this.style.color='#4f46e5';this.style.borderColor='#c7d2fe'">${d} วัน</button>`).join('')}
                        </div>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        <div class="col-span-1">
                            <label class="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1 block text-center">จำนวน</label>
                            <input type="number" value="${item.quantity}" 
                                oninput="App.updateTempItem(${index}, 'quantity', this.value)"
                                class="w-full bg-stone-50 border-none rounded-xl px-1 py-2 text-center text-xs font-bold text-stone-800 focus:ring-2 focus:ring-indigo-100 outline-none transition-all">
                        </div>
                        <div class="col-span-1">
                            <label class="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1 block text-center">หน่วย</label>
                            <input type="text" value="${item.unit}" 
                                oninput="App.updateTempItem(${index}, 'unit', this.value)"
                                class="w-full bg-stone-50 border-none rounded-xl px-1 py-2 text-center text-[10px] font-bold text-stone-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all">
                        </div>
                        <div class="col-span-1">
                            <label class="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1 block text-center">ราคา</label>
                            <input type="number" value="${item.price}" 
                                oninput="App.updateTempItem(${index}, 'price', this.value)"
                                class="w-full bg-indigo-50 border-none rounded-xl px-1 py-2 text-center text-xs font-black text-indigo-600 focus:ring-2 focus:ring-indigo-100 outline-none transition-all">
                        </div>
                    </div>
                </div>
                
                <!-- Image Capture Section -->
                <div class="mt-1 flex items-center gap-3 bg-stone-50 p-2 rounded-2xl border border-stone-100">
                    <div class="w-12 h-12 rounded-xl bg-white border border-stone-200 flex items-center justify-center overflow-hidden shrink-0">
                        ${item.image_url ? 
                            `<img src="${item.image_url}" class="w-full h-full object-cover">` : 
                            `<i data-lucide="image" class="w-5 h-5 text-stone-300"></i>`
                        }
                    </div>
                    <div class="flex-1">
                        <button onclick="document.getElementById('batch-img-${index}').click()" 
                                class="w-full py-2 px-3 bg-white border border-stone-200 rounded-xl text-[10px] font-bold text-stone-600 flex items-center justify-center gap-2 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all">
                            <i data-lucide="camera" class="w-3.5 h-3.5"></i> ถ่ายรูปสินค้า
                        </button>
                        <input type="file" id="batch-img-${index}" class="hidden" accept="image/*" capture="environment" 
                               onchange="App.handleBatchImageCapture(${index}, this)">
                    </div>
                </div>
            </div>
        `).join('') + `
            <button onclick="App.addBlankTempItem()" class="w-full py-6 border-2 border-dashed border-stone-200 rounded-3xl text-stone-400 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50 transition-all flex flex-col items-center justify-center gap-2 group">
                <i data-lucide="plus-circle" class="w-8 h-8 group-hover:scale-110 transition-transform"></i>
                <span class="font-bold">เพิ่มรายการใหม่</span>
            </button>
        `;
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    updateTempItem(index, key, value) {
        if (!this.tempReceiptItems[index]) return;
        this.tempReceiptItems[index][key] = (key === 'quantity' || key === 'price') ? parseFloat(value) || 0 : value;
    },

    setQuickExpiry(index, days) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        const isoStr = d.toISOString().slice(0, 16);
        this.updateTempItem(index, 'expiryISO', isoStr);
        const input = document.getElementById(`expiry_${index}`);
        if (input) input.value = isoStr;
    },

    removeTempItem(index) {
        this.tempReceiptItems.splice(index, 1);
        const countTxt = document.getElementById('receiptCountText');
        if (countTxt) countTxt.textContent = `พบทั้งหมด ${this.tempReceiptItems.length} รายการ`;
        this.updateReceiptReviewList();
    },

    closeReceiptReview() {
        document.getElementById('receiptReviewModal').classList.add('hidden');
        this.tempReceiptItems = [];
    },

    async handleBatchImageCapture(index, input) {
        if (!input.files || !input.files[0]) return;
        const file = input.files[0];
        
        try {
            this.showToast("กำลังประมวลผลรูปภาพ...", "text-blue-400");
            const thumbData = await this.compressImageToBase64(file, false, 120);
            this.updateTempItem(index, 'image_url', thumbData);
            this.updateReceiptReviewList();
            this.showToast("✅ บันทึกรูปภาพชั่วคราวแล้ว", "text-green-400");
        } catch (e) {
            console.error("Batch image capture failed", e);
            this.showToast("ถ่ายรูปไม่สำเร็จ รบกวนลองใหม่ครับ", "text-red-400");
        }
    },

    async saveAllReceiptItems() {
        if (this.tempReceiptItems.length === 0) {
            this.closeReceiptReview();
            return;
        }

        const btn = document.getElementById('btnSaveBatch');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<div class="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full"></div> กำลังบันทึก...`;

        try {
            for (const item of this.tempReceiptItems) {
                const docId = generateDocId();
                const payload = {
                    name: item.name,
                    brand: item.brand || '',
                    size: item.size || '',
                    expiry_date: item.expiryISO,
                    category: item.category || "อื่นๆ",
                    quantity: item.quantity,
                    price: item.price,
                    unit: item.unit,
                    is_opened: 0,
                    image_url: item.image_url || null,
                    production_date: new Date().toISOString().split('T')[0]
                };

                await db.collection('items').doc(docId).set(payload);
            }

            this.showToast(`✨ บันทึก ${this.tempReceiptItems.length} รายการสำเร็จ!`, "text-green-400");
            this.closeReceiptReview();
            
            // Context-aware refresh/redirect
            if (window.location.pathname.endsWith('add.html')) {
                setTimeout(() => window.location.href = 'index.html', 1500);
            } else {
                await this.loadData();
                this.renderList();
                if (document.getElementById('allStockContainer')) this.renderAllStock(); 
            }
        } catch (e) {
            console.error("Batch save failed", e);
            this.showToast("บันทึกไม่สำเร็จ รบกวนลองใหม่ครับ", "text-red-400");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    },



    // ==========================================

    checkNotificationStatus() {
        const btn = document.getElementById('btnNotify');
        const badge = document.getElementById('notifyBadge');

        if ("Notification" in window && Notification.permission === "granted") {
            isNotifyActive = true;
            this.updateNotifyUI(true);
        } else if (isNotifyActive) {
            this.updateNotifyUI(true);
        }
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    updateNotifyUI(isActive) {
        const btn = document.getElementById('btnNotify');
        const badge = document.getElementById('notifyBadge');

        if (isActive) {
            btn.classList.remove('bg-stone-100', 'text-stone-500');
            btn.classList.add('bg-amber-100', 'text-amber-600', 'border', 'border-amber-300');
            btn.innerHTML = '<i data-lucide="bell-ring" class="w-4 h-4 animate-pulse"></i>';
            if (badge) badge.classList.add('hidden');
        } else {
            btn.classList.add('bg-stone-100', 'text-stone-500');
            btn.classList.remove('bg-amber-100', 'text-amber-600', 'border', 'border-amber-300');
            btn.innerHTML = '<i data-lucide="bell" class="w-4 h-4"></i><span id="notifyBadge" class="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border border-white"></span>';
            if (badge) badge.classList.remove('hidden');
        }
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    toggleNotificationPanel() {
        const panel = document.getElementById('notifyPanel');
        if (panel.classList.contains('hidden')) {
            panel.classList.remove('hidden');
            this.renderNotifications();
        } else {
            panel.classList.add('hidden');
        }
    },

    async renderNotifications(catFilter = 'all') {
        const container = document.getElementById('notifyList');
        if (!container) return;

        // Update buttons
        const bns = document.querySelectorAll('#notifyFilterContainer button');
        bns.forEach(b => {
            const text = b.textContent.trim();
            const isMatch = (catFilter === 'all' && text === 'ทั้งหมด') || (catFilter !== 'all' && catFilter.includes(text));
            b.className = isMatch ? "px-3 py-1 rounded-full text-[10px] font-bold transition bg-stone-800 text-white shadow-sm flt-btn" : "px-3 py-1 rounded-full text-[10px] font-bold transition bg-stone-100 text-stone-600 border border-stone-200 shadow-sm flt-btn";
        });

        const alerts = this.inventory.filter(i => {
            if (catFilter !== 'all' && i.category !== catFilter) return false;
            const diffMs = new Date(i.expiryISO) - new Date();
            return diffMs <= (12 * 3600000);
        });

        alerts.sort((a, b) => new Date(a.expiryISO) - new Date(b.expiryISO));

        let html = '<h3 class="text-xs font-bold text-stone-500 mb-2 mt-1 px-1">🔴 แจ้งเตือนปัจจุบัน (ด่วนสุด)</h3>';

        if (alerts.length === 0) {
            html += '<div class="text-center text-stone-400 text-xs py-4 bg-white rounded-xl border border-stone-100 shadow-sm">ไม่มีสินค้าใกล้วิกฤตในหมวดหมู่นี้ 🎉</div>';
        } else {
            alerts.forEach(item => {
                const diffMs = new Date(item.expiryISO) - new Date();
                const diffHours = Math.floor(diffMs / 3600000);
                const isExpired = diffHours < 0;

                const badgeClass = isExpired ? 'bg-stone-200 text-stone-600' : 'bg-red-100 text-red-600 animate-pulse';
                const iconClass = isExpired ? 'text-stone-400' : 'text-red-500';
                const titleText = isExpired ? 'หมดอายุแล้ว' : `ด่วน! หมดใน ${diffHours} ชม.`;

                html += `
                        <div class="bg-white p-3 rounded-xl shadow-sm border border-stone-100 flex items-start gap-3 mb-2 hover:border-red-200 transition cursor-pointer" onclick="App.setFilter('danger'); App.toggleNotificationPanel();">
                            <div class="mt-1 ${iconClass} shrink-0"><i data-lucide="${isExpired ? 'archive' : 'alert-circle'}" class="w-5 h-5"></i></div>
                            <div class="flex-1">
                                <h4 class="font-bold text-stone-800 text-sm">${item.name}</h4>
                                <div class="text-[10px] mt-1 inline-block px-1.5 py-0.5 rounded ${badgeClass} font-bold">${titleText}</div>
                            </div>
                        </div>`;
            });
        }

        html += '<h3 class="text-xs font-bold text-stone-500 mb-2 mt-6 px-1 flex justify-between"><span><i data-lucide="history" class="w-3 h-3 inline"></i> ประวัติรับผิดชอบ/ทิ้งสต๊อกล่าสุด</span></h3>';
        try {
            const snapshot = await db.collection('waste_logs').orderBy('date_recorded', 'desc').limit(15).get();
            const logs = snapshot.docs.map(doc => doc.data());
            let shownLogs = 0;
            for (const log of logs) {
                const logDate = new Date(log.date_recorded);
                const dStr = logDate.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const badge = log.status === 'used' ? `<span class="text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-md">ใช้หมด</span>` : `<span class="text-red-500 bg-red-50 px-1.5 py-0.5 rounded-md">ทิ้ง</span>`;
                html += `
                        <div class="bg-white p-3 rounded-xl shadow-sm border border-stone-100 flex items-center justify-between mb-2">
                            <div class="flex flex-col flex-1 overflow-hidden pr-2">
                                <span class="font-bold text-xs text-stone-700 truncate">${log.item_name} ${log.quantity > 1 ? `(x${log.quantity})` : ''}</span>
                                <span class="text-[10px] text-stone-400 mt-0.5">${dStr} น.</span>
                            </div>
                            <div class="text-[10px] font-bold shrink-0">${badge}</div>
                        </div>
                        `;
                shownLogs++;
            }
            if (shownLogs === 0) {
                html += '<div class="text-center text-stone-400 text-xs py-4 bg-white rounded-xl border border-stone-100 shadow-sm">ยังไม่มีประวัติการนำออกจากตู้เย็น</div>';
            }
        } catch (e) { console.error("Firebase notification render failed", e); }

        container.innerHTML = html;
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },
    
    // Helper to convert VAPID public key
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    },

    async requestNotifyPermission() {
        this.closeModal('notifyModal');

        if (!("Notification" in window)) {
            return this.enableInAppNotification();
        }

        try {
            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
                return this.enableInAppNotification();
            }

            isNotifyActive = true;
            this.updateNotifyUI(true);
            this.showToast("ระบบแจ้งเตือนในแอปพร้อมใช้งาน!", "text-green-400");

        } catch (e) {
            console.error("Push subscription error:", e);
            this.enableInAppNotification();
        }
    },

    enableInAppNotification() {
        isNotifyActive = true;
        this.updateNotifyUI(true);
        this.showToast("เปิดแจ้งเตือนภายในแอปสำเร็จ!<br><span class='text-[10px] text-amber-200'>จะแจ้งเตือนเมื่อคุณเปิดหน้านี้ทิ้งไว้</span>", "text-green-400");
    },

    async backgroundCheck() {
        if (!isNotifyActive) return;

        let needsSave = false;
        const now = new Date();

        for (let item of this.inventory) {
            const exp = new Date(item.expiryISO);
            const diffMs = exp - now;
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

            // 1. Expiry Check
            let currentLevel = 'safe';
            if (diffHours < 0) currentLevel = 'expired';
            else if (diffHours <= 12) currentLevel = 'danger';

            if (currentLevel !== 'safe' && item.notifiedLevel !== currentLevel) {
                let title = "Cafe Stock Alert";
                let body = "";

                if (currentLevel === 'expired') {
                    title = "หมดอายุแล้ว!";
                    body = `[ ${item.name} ] หมดอายุการใช้งานแล้ว กรุณาทิ้งครับ`;
                }
                else if (currentLevel === 'danger') {
                    title = "เตรียมของด่วน!";
                    body = `[ ${item.name} ] จะหมดอายุในอีก ${diffHours} ชั่วโมง`;
                }

                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("❌ " + title, { body: body });
                }
                this.showToast(body, "text-white", true, title);

                item.notifiedLevel = currentLevel;
                needsSave = true;

                try {
                    await db.collection('items').doc(item.id.toString()).update({ notifiedLevel: currentLevel });
                } catch (e) { }
            }

            // 2. Low Stock Check (New)
            const qty = item.quantity || 1;
            const minQty = item.min_quantity || 0;
            if (minQty > 0 && qty <= minQty && item.notifiedLowStock !== true) {
                const title = "สินค้าใกล้หมด!";
                const body = `[ ${item.name} ] เหลือเพียง ${qty} ชิ้น (ต่ำกว่าเกณฑ์ ${minQty} ชิ้น)`;

                if ("Notification" in window && Notification.permission === "granted") {
                    new Notification("⚠️ " + title, { body: body });
                }
                this.showToast(body, "text-amber-500", true, title);

                item.notifiedLowStock = true; // Local flag to avoid repeat in same session
                // In a real app, we'd save this to DB too, but for now local is fine to avoid spam
            }
        }

        if (needsSave) {
            this.renderList();
        }
    },

    // ==========================================

    initQuickAdd() {
        document.getElementById('q_itemName').value = '';
        setTimeout(() => document.getElementById('q_itemName').focus(), 100);
    },

    async saveQuickAdd(daysToAdd) {
        const name = document.getElementById('q_itemName').value.trim();
        const catInput = document.getElementById('q_itemCategory') ? document.getElementById('q_itemCategory').value : 'อื่นๆ';
        const isOpened = document.getElementById('q_isOpened') && document.getElementById('q_isOpened').checked ? 1 : 0;
        const prodDate = document.getElementById('q_itemProdDate') ? document.getElementById('q_itemProdDate').value : null;
        const minQty = document.getElementById('q_minQty') ? parseInt(document.getElementById('q_minQty').value) || 0 : 0;
        if (!name) return this.showToast("กรุณาพิมพ์ชื่อวัตถุดิบก่อนครับ", 'text-orange-400');
        const d = new Date(); d.setDate(d.getDate() + daysToAdd);
        await this.addItemToInventory(name, d.toISOString(), "quick", catInput, 1, prodDate, isOpened, minQty);
        this.showToast(`เพิ่ม <b>${name}</b> (อยู่ได้อีก ${daysToAdd} วัน) เรียบร้อย!`, 'text-green-400');
        setTimeout(() => window.location.href = 'index.html', 500);
    },

    initAddForm() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('fromScan') === 'true') {
            const scannedDataRaw = sessionStorage.getItem('scannedData');
            if (scannedDataRaw) {
                const data = JSON.parse(scannedDataRaw);
                if (data.name) {
                    document.getElementById('n_itemName').value = data.name;
                } else {
                    document.getElementById('n_itemName').value = "";
                    document.getElementById('n_itemName').placeholder = "ระบุชื่อเอง (AI อ่านไม่ออก)";
                }

                if (data.expiryDate) {
                    document.getElementById('n_expiryDate').value = data.expiryDate;
                    setTimeout(() => this.showToast(`✨ AI สแกนสำเร็จ! ยืนยันข้อมูลก่อนบันทึก`, 'text-green-400'), 500);
                } else {
                    setTimeout(() => this.showToast("AI หาวันที่ชัดเจนไม่เจอ รบกวนระบุเองครับ", 'text-orange-400'), 500);
                }
                sessionStorage.removeItem('scannedData');
                setTimeout(() => document.getElementById('n_itemName').focus(), 100);
                return; // exit early since it's prefilled
            }
        }

        if (!document.getElementById('n_itemName').value || document.getElementById('n_itemName').value === "[AI สแกนได้โปรดระบุชื่อ]") {
            document.getElementById('n_itemName').value = '';
        }

        if (!document.getElementById('n_expiryDate').value) {
            const d = new Date(); d.setDate(d.getDate() + 3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            document.getElementById('n_expiryDate').value = d.toISOString().slice(0, 16);
        }

        setTimeout(() => document.getElementById('n_itemName').focus(), 100);
    },

    async handleNormalAdd(e) {
        e.preventDefault();
        const name = document.getElementById('n_itemName').value;
        const expiryStr = document.getElementById('n_expiryDate').value;
        const category = document.getElementById('n_itemCategory') ? document.getElementById('n_itemCategory').value : 'อื่นๆ';
        const rawQuantity = document.getElementById('n_itemQty') ? parseInt(document.getElementById('n_itemQty').value) || 1 : 1;
        const multiplier = document.getElementById('n_itemMultiplier') ? parseInt(document.getElementById('n_itemMultiplier').value) || 1 : 1;
        const quantity = rawQuantity * multiplier;
        const minQuantity = document.getElementById('n_minQty') ? parseInt(document.getElementById('n_minQty').value) || 0 : 0;
        const price = document.getElementById('n_itemPrice') ? parseFloat(document.getElementById('n_itemPrice').value) || 0 : 0;
        const prodDate = document.getElementById('n_itemProdDate') ? document.getElementById('n_itemProdDate').value : null;
        const isOpened = document.getElementById('n_isOpened') && document.getElementById('n_isOpened').checked;

        await this.addItemToInventory(name, new Date(expiryStr).toISOString(), "manual", category, quantity, prodDate, isOpened, minQuantity, price);


        this.showToast("บันทึกรายการสำเร็จ!", 'text-green-400');
        setTimeout(() => window.location.href = 'index.html', 500);
    },

    async addItemToInventory(name, expiryISO, source, category = 'อื่นๆ', quantity = 1, prodDate = null, isOpenedValue = false, minQuantity = 0, price = 0) {
        const docId = generateDocId();
        const isOpened = isOpenedValue === true || isOpenedValue === 1;
        const now = new Date();
        let freshnessExpiry = null;

        if (isOpened) {
            const freshnessMap = { 'นม/ของเหลว': 3, 'เบเกอรี่': 2, 'กาแฟ/ชา': 30, 'ไซรัป/ผง': 30, 'อื่นๆ': 7 };
            const daysToAdd = freshnessMap[category] || 7;
            freshnessExpiry = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();
        }

        const newItem = {
            name: name,
            expiry_date: expiryISO,
            source: source,
            notifiedLevel: 'none',
            category: category,
            quantity: quantity,
            production_date: prodDate,
            isOpened: isOpened,
            is_opened: isOpened ? 1 : 0, // compatibility
            openedAt: isOpened ? firebase.firestore.FieldValue.serverTimestamp() : null,
            freshnessExpiry: freshnessExpiry,
            min_quantity: minQuantity,
            price: price,
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            await db.collection('items').doc(docId).set(newItem);
            // inventory will be updated by onSnapshot
        } catch (e) {
            console.error("Add Item Error:", e);
        }
    },


    deleteItem(id, name) {
        this.itemToDelete = { id, name };

        const item = this.inventory.find(i => i.id.toString() === id.toString());
        const isExpired = item && (new Date(item.expiryISO) - new Date()) < 0;

        if (document.getElementById('delItemName')) {
            document.getElementById('delItemName').textContent = escapeHtml(name) || 'สินค้านี้';
        }

        const btnUsed = document.querySelector('#deleteConfirmModal button[onclick*="used"]');
        if (btnUsed) {
            if (isExpired) {
                btnUsed.classList.add('hidden');
            } else {
                btnUsed.classList.remove('hidden');
            }
        }

        if (document.getElementById('deleteConfirmModal')) {
            document.getElementById('deleteConfirmModal').classList.remove('hidden');
        }
    },



    cancelDelete() {
        this.itemToDelete = null;
        document.getElementById('deleteConfirmModal').classList.add('hidden');
    },

    calculateDaysLeft(expiryISO) {
        if (!expiryISO) return null;
        const now = new Date();
        const expiry = new Date(expiryISO);
        if (isNaN(expiry)) return null;
        const diffTime = expiry.getTime() - now.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    },

    getUrgency(daysLeft) {
        if (daysLeft === null) return { label: 'ไม่มีวันหมดอายุ', color: 'text-stone-400', border: 'border-stone-100' };
        if (daysLeft < 0) return { label: 'หมดอายุแล้ว', color: 'text-stone-500', border: 'border-stone-200' };
        if (daysLeft <= 1) return { label: 'หมดวันนี้!', color: 'text-red-600', border: 'border-red-200' };
        if (daysLeft <= 3) return { label: `เหลือ ${daysLeft} วัน`, color: 'text-amber-600', border: 'border-amber-200' };
        if (daysLeft <= 7) return { label: `เหลือ ${daysLeft} วัน`, color: 'text-yellow-600', border: 'border-yellow-200' };
        return { label: `เหลือ ${daysLeft} วัน`, color: 'text-emerald-600', border: 'border-emerald-200' };
    },

    getCategoryColor(category, isBg = false) {
        const colors = {
            'นม/ของเหลว': isBg ? 'bg-blue-500' : 'text-blue-500',
            'กาแฟ/ชา': isBg ? 'bg-amber-700' : 'text-amber-700',
            'ไซรัป': isBg ? 'bg-purple-500' : 'text-purple-500',
            'เบเกอรี่': isBg ? 'bg-pink-500' : 'text-pink-500',
            'อื่นๆ': isBg ? 'bg-stone-500' : 'text-stone-500',
        };
        return colors[category] || (isBg ? 'bg-stone-500' : 'text-stone-500');
    },

    getCategoryIcon(category) {
        const icons = {
            'นม/ของเหลว': 'milk',
            'กาแฟ/ชา': 'coffee',
            'ไซรัป': 'flask-conical',
            'เบเกอรี่': 'cake',
            'อื่นๆ': 'package',
        };
        return icons[category] || 'package';
    },

    async initAllStock() {
        await this.loadInventory();
        this.renderAllStock();
    },

    renderAllStock() {
        const container = document.getElementById('allStockContainer');
        if (!container) return;

        this.renderAllStockHeatmap();
        this.renderQuickStatusBar();

        // Filter inventory: Only unopened items for warehouse
        let filteredInventory = this.inventory.filter(i => !i.isOpened && (i.quantity > 0 || i.is_archived !== 1));
        
        if (this.allStockSearchTerm) {
            filteredInventory = filteredInventory.filter(i => i.name.toLowerCase().includes(this.allStockSearchTerm));
        }
        if (this.allStockFilter !== 'all') {
            filteredInventory = filteredInventory.filter(i => i.category === this.allStockFilter);
        }

        if (filteredInventory.length === 0) {
            container.innerHTML = `<div class="text-center text-stone-400 py-20 flex flex-col items-center"><i data-lucide="package-search" class="w-12 h-12 mb-3 opacity-50"></i><p>ไม่พบรายการที่ตรงกับเงื่อนไข</p></div>`;
            if (document.getElementById('grandGroups')) document.getElementById('grandGroups').textContent = 0;
            if (document.getElementById('grandUnits')) document.getElementById('grandUnits').textContent = 0;
            if (document.getElementById('grandOpened')) document.getElementById('grandOpened').textContent = this.inventory.filter(i => i.isOpened).length;
            if (document.getElementById('grandLots')) document.getElementById('grandLots').textContent = 0;
            if (document.getElementById('grandWithImage')) document.getElementById('grandWithImage').textContent = 0;
            if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
            return;
        }

        // Group by name + category
        const grouped = {};
        let grandUnits = 0;

        filteredInventory.forEach(item => {
            const cat = item.category || 'อื่นๆ';
            const groupKey = `${item.name}|${cat}`;
            const qty = parseFloat(item.quantity || 1);
            if (!grouped[groupKey]) grouped[groupKey] = { name: item.name, total: 0, category: cat, lots: [] };
            grouped[groupKey].total += qty;
            grouped[groupKey].lots.push(item);
            grandUnits += qty;
        });

        // Calculate Low Stock
        let grandLowStock = 0;
        Object.values(grouped).forEach(g => {
            if (g.total < 3) grandLowStock++;
        });

        // Update Grand Summary
        const groupKeys = Object.keys(grouped);
        if (document.getElementById('grandGroups')) document.getElementById('grandGroups').textContent = groupKeys.length;
        if (document.getElementById('grandUnits')) document.getElementById('grandUnits').textContent = grandUnits;
        if (document.getElementById('grandOpened')) document.getElementById('grandOpened').textContent = this.inventory.filter(i => i.isOpened).length;
        if (document.getElementById('grandLowStock')) document.getElementById('grandLowStock').textContent = grandLowStock;
        if (document.getElementById('grandLots')) document.getElementById('grandLots').textContent = filteredInventory.length;

        if (this.viewMode === 'grid') {
            container.className = "view-grid-items p-4 pb-32";
        } else {
            container.className = "flex-1 overflow-y-auto p-4 pb-32 relative z-10 space-y-5";
        }

        let html = '';
        let groupIdx = 0;
        for (const [key, data] of Object.entries(grouped)) {
            groupIdx++;
            const name = data.name;

            // Sort lots by urgency (FIFO)
            data.lots.sort((a, b) => {
                const dateA = a.expiryISO ? new Date(a.expiryISO) : new Date(8640000000000000);
                const dateB = b.expiryISO ? new Date(b.expiryISO) : new Date(8640000000000000);
                return dateA - dateB;
            });

            const accordionId = `acc-${groupIdx}`;
            const nowTime = new Date().getTime();
            const hasAlert = data.lots.some(l => {
                const exp = l.expiryISO ? new Date(l.expiryISO).getTime() : Infinity;
                return (exp - nowTime) <= (48 * 3600000); // 48h warning for warehouse
            });
            const alertIcon = hasAlert ? `<span class="flex h-2 w-2 rounded-full bg-amber-500 animate-ping mr-2"></span>` : '';
            const groupImageUrl = (data.lots.find(l => l.image_url)?.image_url || '').replace(/'/g, "\\'");
            const groupThumb = groupImageUrl
                ? `<img src="${groupImageUrl}" class="w-12 h-12 rounded-2xl object-cover border border-stone-100 shadow-sm">`
                : `<div class="w-12 h-12 rounded-2xl flex items-center justify-center ${this.getCategoryColor(data.category, true)} shadow-sm text-white"><i data-lucide="${this.getCategoryIcon(data.category)}" class="w-6 h-6"></i></div>`;

            if (this.viewMode === 'grid') {
                // Grid Card for Warehouse Group
                const borderColor = hasAlert ? 'border-amber-400' : 'border-stone-100';
                const bgTint = hasAlert ? 'bg-amber-50/30' : 'bg-white';
                
                html += `<div class="bg-white rounded-3xl shadow-sm border-2 ${borderColor} overflow-hidden flex flex-col group hover:shadow-md transition-all duration-300 ${bgTint}">
                            <div class="relative overflow-hidden bg-stone-50 shrink-0">
                                <img src="${groupImageUrl || 'https://www.transparenttextures.com/patterns/cubes.png'}" class="grid-thumbnail-fix rounded-t-2xl object-cover">
                                <div class="absolute bottom-2 left-2 bg-black/40 backdrop-blur-md p-1.5 rounded-xl text-white">
                                     <i data-lucide="${this.getCategoryIcon(data.category)}" class="w-3 h-3"></i>
                                </div>
                                ${hasAlert ? `<div class="absolute top-2 right-2 bg-amber-500 w-2 h-2 rounded-full animate-ping"></div>` : ''}
                            </div>
                            <div class="p-4 flex flex-col flex-1 min-w-0">
                                <span class="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1 block">${data.category}</span>
                                <h3 class="text-base font-black text-stone-900 leading-snug mb-3 line-clamp-2" title="${name}">${name}</h3>
                                
                                <div class="mt-auto flex items-center justify-between">
                                    <span class="text-sm font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-xl">รวม ${data.total}</span>
                                    <button onclick="App.toggleAccordion('${accordionId}')" class="p-2 bg-stone-50 hover:bg-stone-100 rounded-xl transition">
                                        <i data-lucide="more-horizontal" class="w-4 h-4 text-stone-400"></i>
                                    </button>
                                </div>
                            </div>
                            
                            <div id="${accordionId}" class="hidden p-4 space-y-2 bg-stone-50/50 border-t border-stone-100">
                `;
            } else {
                // Compact List Item for Warehouse Group
                const hasOpened = data.lots.some(l => l.isOpened);
                const isLow = data.total < 3;
                
                html += `<div class="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden mb-3">
                            <div onclick="App.toggleAccordion('${accordionId}')" class="flex justify-between items-center p-4 cursor-pointer hover:bg-stone-50 transition-colors">
                                <div class="flex items-center gap-4 flex-1 min-w-0">
                                    <div class="relative">
                                        ${groupThumb}
                                        ${hasAlert ? `<div class="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-white"></div>` : ''}
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-2 mb-0.5">
                                            <h2 class="text-sm font-black text-stone-800 truncate">${name}</h2>
                                            <div class="flex gap-1 shrink-0">
                                                ${hasOpened ? `<span class="bg-orange-100 text-orange-600 text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase">📍 แกะแล้ว</span>` : ''}
                                                ${isLow ? `<span class="bg-rose-100 text-rose-600 text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase">⚠️ ต่ำกว่าเกณฑ์</span>` : ''}
                                            </div>
                                        </div>
                                        <span class="text-[9px] font-bold text-stone-400 uppercase tracking-widest">${data.category}</span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-4">
                                    <div class="text-right">
                                        <span class="block text-xs font-black text-indigo-600">สต๊อก ${data.total}</span>
                                        <span class="text-[8px] text-stone-300 font-bold uppercase tracking-widest">ใน ${data.lots.length} ล็อต</span>
                                    </div>
                                    <i data-lucide="chevron-down" id="icon-${accordionId}" class="w-4 h-4 text-stone-300 transition-transform duration-300"></i>
                                </div>
                            </div>
                            
                            <div id="${accordionId}" class="hidden px-4 pb-4 space-y-2 border-t border-stone-50 pt-3 bg-stone-50/20">
                `;
            }

            const previewLimit = 4;
            data.lots.forEach((lot, lotIndex) => {
                const qty = lot.quantity;
                const daysLeft = this.calculateDaysLeft(lot.expiryISO);
                const urgency = this.getUrgency(daysLeft);
                const lotImageUrl = (lot.image_url || '').replace(/'/g, "\\'");
                const lotThumb = lotImageUrl
                    ? `<img src="${lotImageUrl}" class="w-12 h-12 rounded-2xl object-cover border border-stone-100 shadow-sm">`
                    : `<div class="w-12 h-12 rounded-2xl flex items-center justify-center ${this.getCategoryColor(lot.category, true)} shadow-sm shrink-0 text-white">
                                    <i data-lucide="${this.getCategoryIcon(lot.category)}" class="w-6 h-6"></i>
                               </div>`;

                const hiddenClass = lotIndex >= previewLimit ? ` lot-extra-${accordionId} hidden` : '';
                const lotCategoryColor = this.getCategoryColor(lot.category, true).replace('bg-', 'border-');
                
                html += `<div class="flex items-center justify-between p-4 rounded-2xl border-l-4 ${lotCategoryColor} border-stone-100 bg-stone-50/80 shadow-sm gap-4 ml-2 sm:ml-4${hiddenClass}">
                            <div class="flex items-center gap-4 flex-1 min-w-0">
                                ${lotThumb}
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-2 mb-1">
                                        <span class="text-[10px] font-bold ${urgency.color} px-2 py-0.5 bg-white rounded-lg border ${urgency.border}">${urgency.label}</span>
                                        ${lot.brand ? `<span class="text-[10px] font-bold text-stone-500 truncate">${lot.brand}</span>` : ''}
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <span class="text-base font-black text-stone-800">${qty} ${lot.unit || 'ชิ้น'}</span>
                                        ${lot.size ? `<span class="text-xs text-stone-400 font-bold">(${lot.size})</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            <button onclick="App.handleOpenItem('${lot.id}')" class="px-5 py-3 bg-white text-stone-800 border border-stone-200 rounded-2xl font-black text-[11px] hover:bg-stone-100 transition active:scale-95 shadow-sm flex items-center gap-2">
                                <i data-lucide="package-open" class="w-4 h-4 text-emerald-500"></i> แกะใช้งาน
                            </button>
                        </div>`;
            });

            if (data.lots.length > previewLimit) {
                html += `
                    <button id="lot-toggle-${accordionId}" data-expanded="0" onclick="App.toggleLotPreview('${accordionId}', ${previewLimit}, ${data.lots.length})" class="w-full py-2.5 px-4 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-2xl border border-indigo-100 transition">
                        ดูเพิ่มอีก ${data.lots.length - previewLimit} ล็อต
                    </button>
                `;
            }

            html += `</div></div>`;
        }

        container.innerHTML = html;
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },


    addQuickItem() {
        this.itemToDelete = null;
        document.getElementById('deleteConfirmModal').classList.add('hidden');
    },

    async confirmDelete(status) {
        if (this.itemToDelete !== null) {
            const item = this.inventory.find(i => i.id.toString() === this.itemToDelete.id.toString());
            if (item) {
                try {
                    const logData = {
                        date_recorded: new Date().toISOString(),
                        item_name: item.name,
                        quantity: item.quantity || 1,
                        price: item.price || 0,
                        status: status
                    };
                    // บันทึก log แยกล็อต
                    await db.collection('waste_logs').doc(Date.now().toString()).set(logData);
                    // ลบสินค้าตัวนี้
                    await db.collection('items').doc(item.id.toString()).delete();

                    this.inventory = this.inventory.filter(i => i.id !== item.id);
                    this.renderList();
                    if (document.getElementById('allStockContainer')) this.renderAllStock();
                    this.showToast(status === 'used' ? "นำไปใช้งานแล้ว เยี่ยมมาก!" : "บันทึกของเสียเข้าระบบแล้ว", status === 'used' ? "text-emerald-400" : "text-stone-400");
                } catch (e) { console.error("Firebase delete failed", e); }
            }
            this.itemToDelete = null;
        }
        document.getElementById('deleteConfirmModal').classList.add('hidden');
    },

    saveData() { /* Obsolete, keeping for compatibility signature */ },
    closeModal(id) { document.getElementById(id).classList.add('hidden'); },

    showAiHelp() {
        document.getElementById('aiHelpModal').classList.remove('hidden');
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    generateSummaryData() {
        const now = new Date();
        const dateHeader = now.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
        let stats = { expired: 0, danger: 0, warning: 0, safe: 0 };
        if (this.inventory.length === 0) {
            let text = `☕ แจ้งเตือนเช็คสต๊อกบาร์\n🗓 ประจำวันที่: ${dateHeader}\n\n[สถานะปัจจุบัน]\n❌ ไม่มีวัตถุดิบในระบบ\n\n`;
            return { text, stats };
        }
        // Group identical items by name and expiry
        const groups = {};
        this.inventory.forEach(item => {
            const key = `${item.name}|${item.expiryISO}`;
            if (!groups[key]) {
                groups[key] = { ...item, totalQty: parseFloat(item.quantity) || 1 };
            } else {
                groups[key].totalQty += parseFloat(item.quantity) || 1;
            }
        });

        const groupedArray = Object.values(groups).sort((a, b) => new Date(a.expiryISO) - new Date(b.expiryISO));
        let expiredList = [], dangerList = [], warningList = [], safeList = [];

        groupedArray.forEach(item => {
            const exp = new Date(item.expiryISO);
            const diffMs = exp - now;
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            const timeStr = exp.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' ' + exp.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + 'น.';
            const qtyStr = item.totalQty > 1 ? ` (${item.totalQty} ${item.unit || 'ชิ้น'})` : '';

            if (diffHours < 0) { stats.expired++; expiredList.push(`❌ ${item.name}${qtyStr}\n   └ หมดอายุไปแล้ว ${Math.abs(diffHours)} ชม.`); }
            else if (diffHours <= 12) { stats.danger++; dangerList.push(`🔴 ${item.name}${qtyStr}\n   └ หมดในอีก ${diffHours} ชม. (${timeStr})`); }
            else if (diffHours <= 48) { stats.warning++; warningList.push(`🟡 ${item.name}${qtyStr}\n   └ หมดในอีก ${Math.floor(diffHours / 24)} วัน ${diffHours % 24} ชม.`); }
            else { stats.safe++; safeList.push(`🟢 ${item.name}${qtyStr}\n   └ หมดในอีก ${Math.floor(diffHours / 24)} วัน`); }
        });

        let text = `☕ แจ้งเตือนเช็คสต๊อกบาร์\n🗓 ประจำวันที่: ${dateHeader}\n\n`;
        text += `📊 ภาพรวมวัตถุดิบ:\n- หมดอายุแล้ว(ทิ้ง): ${stats.expired} อย่าง\n- ต้องรีบใช้ด่วน: ${stats.danger} อย่าง\n- เฝ้าระวัง: ${stats.warning} อย่าง\n- ปกติ: ${stats.safe} อย่าง\n\n`;

        if (expiredList.length > 0) text += `[หมดอายุ / ทิ้งได้เลย]\n${expiredList.join('\n')}\n\n`;
        if (dangerList.length > 0) text += `[ด่วน: หมดภายใน 12 ชม.]\n${dangerList.join('\n')}\n\n`;
        if (warningList.length > 0) text += `[เตือน: หมดใน 1-2 วัน]\n${warningList.join('\n')}\n\n`;
        if (safeList.length > 0) text += `[โซนปลอดภัย]\n${safeList.join('\n')}\n\n`;
        text += `-- จากระบบ Cafe Stock Alert --`;
        return { text, stats };
    },

    async generateAISummary() {
        const prevText = document.getElementById('summaryTextPreview') ? document.getElementById('summaryTextPreview').value : '';
        if (!prevText || prevText.includes('ไม่มีวัตถุดิบในระบบให้สรุปครับ')) {
            this.showToast("ไม่มีข้อมูลให้ AI สรุปครับ", "text-orange-400");
            return;
        }

        const textArea = document.getElementById('summaryTextPreview');
        const originalValue = textArea.value;
        textArea.value = '✨ กำลังให้ AI ประมวลผลและเรียบเรียงข้อความให้สละสลวยขึ้น... (รอสักครู่)';

        try {
            const promptText = `คุณคือผู้ช่วยจัดการสต๊อกหลังร้านคาเฟ่แบบมืออาชีพ
จงสรุปข้อความดิบต่อไปนี้ใหม่ เพื่อนำไปส่งในกลุ่ม LINE ของพนักงาน
- ทำให้ข้อความดูเป็นกันเอง กระชับ อ่านเข้าใจง่าย
- ใช้ Emoji เรียกร้องความสนใจให้เหมาะสม เช่น 🔴 สำหรับของด่วน 🟢 สำหรับปกติ 🗑️ สำหรับของทิ้ง
- จัดบรรทัดให้อ่านง่ายบนจอมือถือ
- ห้ามใช้คำฟุ่มเฟือย ขอให้เป็นสรุปที่พร้อมส่งและใช้งานจริง

ข้อมูลดิบ:
"""
${originalValue}
"""`;
            console.log("🤖 AI Summary Prompt:", promptText);

            const responseJson = await this.callGemini(promptText);

            if (responseJson && responseJson.candidates && responseJson.candidates[0].content.parts[0].text) {
                textArea.value = responseJson.candidates[0].content.parts[0].text.trim();
                this.showToast("✨ AI เรียบเรียงให้เรียบร้อยแล้ว!", "text-green-400");
            } else {
                textArea.value = originalValue;
                this.showToast("เกิดข้อผิดพลาดในการเรียก AI", "text-red-400");
            }
        } catch (e) {
            textArea.value = originalValue;
            this.showToast("เชื่อมต่อ AI ล้มเหลว", "text-red-400");
        }
    },

    async initSummary() {
        let { text, stats } = this.generateSummaryData();

        const expEl = document.getElementById('sum-expired');
        const dangerEl = document.getElementById('sum-danger');
        const warningEl = document.getElementById('sum-warning');
        const safeEl = document.getElementById('sum-safe');

        if (expEl) expEl.textContent = stats.expired;
        if (dangerEl) dangerEl.textContent = stats.danger;
        if (warningEl) warningEl.textContent = stats.warning;
        if (safeEl) safeEl.textContent = stats.safe;

        try {
            const snapshot = await db.collection('waste_logs').get();
            const logs = snapshot.docs.map(doc => doc.data());
            const todayStr = new Date().toISOString().split('T')[0];
            let todayCount = 0;
            let todayCost = 0;
            let totalWasteCost = 0;
            let listHtml = '';

            logs.forEach(log => {
                if (log.status === 'wasted') {
                    totalWasteCost += (log.price || 0) * (log.quantity || 1);
                    if (log.date_recorded.startsWith(todayStr)) {
                        todayCount += log.quantity;
                        todayCost += (log.price || 0) * (log.quantity || 1);
                        listHtml += `
                                <div class="flex justify-between items-center text-sm py-2.5 border-b border-stone-100 last:border-0 hover:bg-stone-50 transition px-2 rounded">
                                    <div class="flex flex-col">
                                        <span class="text-stone-700 truncate pr-2 font-medium">${log.item_name}</span>
                                        <span class="text-[9px] text-stone-400">@ ${log.price || 0} บ.</span>
                                    </div>
                                    <span class="font-bold text-red-500 shrink-0">-${log.quantity}</span>
                                </div>`;
                    }
                }
            });

            if (listHtml === '') listHtml = '<div class="text-center text-emerald-500 text-xs py-3 font-bold">ไม่มีของทิ้งวันนี้ สุดยอดมาก! 🌟</div>';

            const wasteListEl = document.getElementById('wasteList');
            const wasteTotalEl = document.getElementById('wasteTotal');
            const sumWasteCostEl = document.getElementById('sum-waste-cost');

            if (wasteListEl) wasteListEl.innerHTML = listHtml;
            if (wasteTotalEl) wasteTotalEl.textContent = `ทิ้งวันนี้: ${todayCount} ชิ้น (${todayCost.toLocaleString()} บ.)`;
            if (sumWasteCostEl) {
                sumWasteCostEl.textContent = totalWasteCost.toLocaleString();
            }

            text += `\n\n------------------------\n🗑️ สถิติของเสียสะสม: ${totalWasteCost.toLocaleString()} บาท`;
            text += `\n🗑️ เฉพาะวันนี้: ทิ้งรวม ${todayCount} รายการ (มูลค่า ${todayCost.toLocaleString()} บาท)`;
        } catch (e) { console.error("Firebase summary data failed", e); }

        document.getElementById('summaryTextPreview').value = text;
        this.renderCharts();
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    async renderCharts() {
        const wasteCanvas = document.getElementById('wasteChart');
        const expiryCanvas = document.getElementById('expiryForecastChart');
        const categoryCanvas = document.getElementById('categoryChartJs');
        const costCatCanvas = document.getElementById('wasteCostCategoryChart');

        if (!categoryCanvas) return;

        // Helper: destroy existing chart before creating new one
        const safeChart = (canvas, config) => {
            const existing = Chart.getChart(canvas);
            if (existing) existing.destroy();
            return new Chart(canvas, config);
        };

        // 1. Category Chart (Doughnut)
        const catData = {};
        this.inventory.forEach(item => {
            const cat = item.category || 'อื่นๆ';
            catData[cat] = (catData[cat] || 0) + (item.quantity || 1);
        });

        safeChart(categoryCanvas, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catData),
                datasets: [{
                    data: Object.values(catData),
                    backgroundColor: ['#6366f1', '#f59e0b', '#10b981', '#f43f5e', '#0ea5e9', '#78716c'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10, family: 'Prompt' } } }
                }
            }
        });

        // 2. Data from Waste Logs
        try {
            const snapshot = await db.collection('waste_logs').get();
            const logs = snapshot.docs.map(doc => doc.data());

                // 2.1 Waste Trend (Last 7 Days)
                if (wasteCanvas) {
                    const last7Days = [];
                    for (let i = 6; i >= 0; i--) {
                        const d = new Date();
                        d.setDate(d.getDate() - i);
                        last7Days.push(d.toISOString().split('T')[0]);
                    }

                    const wasteData = last7Days.map(date => {
                        return logs.filter(l => l.date_recorded.startsWith(date) && l.status === 'wasted')
                            .reduce((sum, l) => sum + (l.quantity || 1), 0);
                    });

                    safeChart(wasteCanvas, {
                        type: 'line',
                        data: {
                            labels: last7Days.map(d => d.split('-').slice(1).join('/')),
                            datasets: [{
                                label: 'จำนวนชิ้นที่ทิ้ง',
                                data: wasteData,
                                borderColor: '#ef4444',
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                fill: true,
                                tension: 0.4,
                                pointRadius: 4,
                                pointBackgroundColor: '#ef4444'
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: true, ticks: { font: { size: 9 } } },
                                x: { ticks: { font: { size: 9 } } }
                            }
                        }
                    });
                }

                // 2.2 Waste Cost by Category (New)
                if (costCatCanvas) {
                    const costCatData = {};
                    const itemToCat = {};
                    this.inventory.forEach(i => itemToCat[i.name] = i.category || 'อื่นๆ');

                    logs.filter(l => l.status === 'wasted').forEach(log => {
                        const cat = itemToCat[log.item_name] || 'อื่นๆ';
                        costCatData[cat] = (costCatData[cat] || 0) + ((log.price || 0) * (log.quantity || 1));
                    });

                    safeChart(costCatCanvas, {
                        type: 'bar',
                        data: {
                            labels: Object.keys(costCatData),
                            datasets: [{
                                label: 'มูลค่า (บาท)',
                                data: Object.values(costCatData),
                                backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#6366f1', '#0ea5e9'],
                                borderRadius: 8
                            }]
                        },
                        options: {
                            indexAxis: 'y',
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#10b981' } },
                                y: { ticks: { font: { size: 9, family: 'Prompt' }, color: '#666' } }
                            }
                        }
                });
            }
        } catch (e) { console.error(e); }

        // 3. Expiry Forecast (Next 7 Days)
        if (expiryCanvas) {
            const forecastDays = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date();
                d.setDate(d.getDate() + i);
                forecastDays.push(d.toISOString().split('T')[0]);
            }

            const forecastData = forecastDays.map(date => {
                return this.inventory.filter(item => (item.expiryISO || '').startsWith(date))
                    .reduce((sum, item) => sum + (item.quantity || 1), 0);
            });

            safeChart(expiryCanvas, {
                type: 'bar',
                data: {
                    labels: forecastDays.map((d, i) => i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : d.split('-').slice(1).reverse().join('/')),
                    datasets: [{
                        label: 'สินค้าที่จะหมดอายุ',
                        data: forecastData,
                        backgroundColor: '#f59e0b',
                        borderRadius: 5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } },
                        x: { ticks: { font: { size: 9 } } }
                    }
                }
            });
        }
    },

    copySummaryText() {
        const text = document.getElementById('summaryTextPreview').value;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.showToast("คัดลอกข้อความสำเร็จ! นำไปวางในกลุ่มได้เลย", "text-green-400");
            }).catch(() => {
                this.showToast("คัดลอกไม่สำเร็จ ลองกดค้างไว้ครับ", "text-red-400");
            });
        } else {
            // Fallback for older browsers
            const textArea = document.getElementById('summaryTextPreview'); textArea.select();
            try { document.execCommand('copy'); this.showToast("คัดลอกข้อความสำเร็จ! นำไปวางในกลุ่มได้เลย", "text-green-400"); } catch (err) { }
        }
    },

    shareSummaryToLine() { this.executeLineShare(document.getElementById('summaryTextPreview').value); },
    shareToLineQuick() {
        if (this.inventory.length === 0) return this.showToast('ตู้เย็นโล่ง ไม่มีของให้แชร์ครับ', 'text-orange-400');
        this.executeLineShare(this.generateSummaryData().text);
    },

    async generateChefSuggestion() {
        const nearExpiryItems = this.inventory.filter(item => {
            const diffMs = new Date(item.expiryISO) - new Date();
            return diffMs > 0 && diffMs <= (3 * 24 * 3600000); // Expiring in next 3 days
        });

        if (nearExpiryItems.length === 0) {
            this.showToast("ยังไม่มีของใกล้หมดอายุให้แนะนำครับ ✨", "text-emerald-400");
            return;
        }

        const container = document.getElementById('chefSuggestionContent');
        const originalHtml = container.innerHTML;
        container.innerHTML = `<div class="flex items-center gap-2"><i data-lucide="loader-2" class="w-4 h-4 animate-spin text-amber-400"></i> <span class="text-xs">Chef กำลังคิดเมนูให้คุณ...</span></div>`;
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }

        const itemsList = nearExpiryItems.map(i => `- ${i.name} (เหลือ ${i.quantity} ${i.category === 'นม/ของเหลว' ? 'ขวด/ลิตร' : 'ชิ้น'})`).join('\n');

        const prompt = `คุณคือ Chef ผู้เชี่ยวชาญการจัดการคาเฟ่และลดขยะอาหาร (Zero Waste)
                นี่คือรายการวัตถุดิบที่กำลังจะหมดอายุในร้าน:
                ${itemsList}

                จงแนะนำ "Special Menu" 2-3 เมนูที่ใช้ของเหล่านี้เป็นหลัก เพื่อเร่งระบายสต็อกก่อนเสีย
                - บอกชื่อเมนูที่น่าดึงดูด
                - บอกสั้นๆ ว่าใช้ของอะไรในร้านบ้าง
                - ใช้ภาษาที่ดูเป็น Chef ใจดีและมืออาชีพ
                - ตอบแบบกระชับ (ไม่เกิน 500 ตัวอักษร) เพื่อให้อ่านง่ายบนมือถือ
                - คืนค่าเป็นข้อความภาษาไทยที่จัดฟอร์แมตให้อ่านง่าย`;

        try {
            const data = await this.callGemini(prompt);
            console.log("AI Response Data:", data);

            if (data && data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
                const result = data.candidates[0].content.parts[0].text.trim();
                container.className = "text-sm leading-relaxed text-indigo-50 border border-indigo-500/20 rounded-xl p-4 bg-indigo-950/40 backdrop-blur-sm";
                container.innerHTML = `<div class="whitespace-pre-line">${result}</div>`;
                this.showToast("👨‍🍳 Chef แนะนำเมนูให้เรียบร้อยแล้ว!", "text-amber-400");
            } else {
                console.error("Invalid AI Response Structure:", data);
                throw new Error("Invalid format");
            }
        } catch (e) {
            container.innerHTML = originalHtml;
            this.showToast("Chef งานยุ่งอยู่ รบกวนลองใหม่นะครับ", "text-red-400");
        }
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    html5QrCode: null,
    openQrScanner() {
        const modal = document.getElementById('qrScannerModal');
        if (!modal) return;
        modal.classList.remove('hidden');

        this.html5QrCode = new Html5Qrcode("qr-reader");
        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        this.html5QrCode.start({ facingMode: "environment" }, config, (decodedText) => {
            this.handleQrScan(decodedText);
        }).catch(err => {
            console.error(err);
            this.showToast("ไม่สามารถเปิดกล้องได้ครับ", "text-red-400");
            this.closeQrScanner();
        });
    },

    closeQrScanner() {
        const modal = document.getElementById('qrScannerModal');
        if (modal) modal.classList.add('hidden');

        if (this.html5QrCode) {
            this.html5QrCode.stop().then(() => {
                this.html5QrCode.clear();
            }).catch(err => console.error(err));
            this.html5QrCode = null;
        }
    },

    handleQrScan(data) {
        this.closeQrScanner();
        this.showToast(`สแกนพบ: ${data}`, "text-amber-400");

        // Logic: If data starts with 'ID:', find and highlight
        if (data.startsWith('ID:')) {
            const id = data.replace('ID:', '').trim();
            const item = this.inventory.find(i => i.id.toString() === id.toString());
            if (item) {
                this.showToast(`พบสินค้า: <b>${item.name}</b>`, "text-green-400");
                // Scroll to item if on index.html
                if (document.getElementById('inventoryList')) {
                    this.searchTerm = item.name;
                    const searchInput = document.getElementById('searchInput');
                    if (searchInput) searchInput.value = item.name;
                    this.renderList();
                }
            } else {
                this.showToast("ไม่พบรายการนี้ในสต๊อก", "text-stone-400");
            }
        }
    },

    async executeLineShare(text) {
        const token = "tTL3Js2E460p1yYXc1XbyYNdovcyoDVxuJ59qfJH5s6hfmScCaxUmTEaq6E8pd8VbUnhdpJHl+DdpIJWvgEjVLFLLR3Bnxu4LSr0ZZUknwplihyHUnffqRc5QGXWcMuvUT8rtxjy1PcCjUX+e2QZDAdB04t89/1O/w1cDnyilFU=";
        const flexPayload = {
            "type": "flex",
            "altText": "แจ้งเตือนเช็คสต๊อกบาร์",
            "contents": {
                "type": "bubble",
                "header": {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        { "type": "text", "text": "☕ สรุปสต๊อกคาเฟ่", "weight": "bold", "size": "xl", "color": "#ffffff" }
                    ],
                    "backgroundColor": "#d97706"
                },
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        { "type": "text", "text": text.substring(0, 2000), "wrap": true, "size": "sm", "color": "#444444" }
                    ]
                },
                "footer": {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {
                            "type": "button",
                            "action": { "type": "uri", "label": "เปิดแอปจัดการสต๊อก", "uri": window.location.origin + window.location.pathname },
                            "style": "primary",
                            "color": "#16a34a"
                        }
                    ]
                }
            }
        };

        try {
            this.showToast("กำลังส่งเข้า LINE OA...", "text-amber-400");
            const response = await fetch("https://api.line.me/v2/bot/message/broadcast", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ messages: [flexPayload] })
            });
            if (response.ok) {
                this.showToast("ส่งข้อความแบบการ์ดเข้า LINE OA สำเร็จ!", "text-[#00B900]");
            } else {
                throw new Error("API responded with " + response.status);
            }
        } catch (e) {
            console.warn("LINE API CORS Blocked. Falling back to URL Scheme.", e);
            
            const copyToClipboard = (str) => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    return navigator.clipboard.writeText(str);
                }
                const textArea = document.createElement("textarea"); textArea.value = str; textArea.style.position = "fixed"; textArea.style.opacity = "0";
                document.body.appendChild(textArea); textArea.focus(); textArea.select();
                try { document.execCommand('copy'); } catch (e) { }
                document.body.removeChild(textArea);
                return Promise.resolve();
            };

            copyToClipboard(text).then(() => {
                const lineUrl = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
                window.open(lineUrl, '_blank');
                this.showToast("คัดลอกแล้ว กำลังส่งไปแอป LINE...", "text-[#00B900]");
            });
        }
    },

    setFilter(f) {
        this.currentFilter = f;
        const buttons = document.querySelectorAll('#filterContainer button');
        if (buttons) buttons.forEach(b => {
            b.className = "px-4 py-1.5 rounded-full text-xs font-bold transition bg-stone-100 text-stone-600 border border-stone-200 shadow-sm flex items-center gap-1";
        });
        const activeBtn = document.getElementById(f === 'นม/ของเหลว' ? 'flt-นม' : f === 'กาแฟ/ชา' ? 'flt-กาแฟ' : f === 'ไซรัป' ? 'flt-ไซรัป' : f === 'เบเกอรี่' ? 'flt-เบเกอรี่' : `flt-${f}`);
        if (activeBtn) activeBtn.className = "px-4 py-1.5 rounded-full text-xs font-bold transition bg-stone-800 text-white shadow-sm flex items-center gap-1";
        this.renderList();
    },

    onSearch(e) {
        this.searchTerm = e.target.value.toLowerCase();
        this.renderList();
    },

    clearSearch() {
        this.searchTerm = '';
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        this.renderList();
    },

    // Phase 3 Helpers
    onAllStockSearch(e) {
        this.allStockSearchTerm = e.target.value.toLowerCase();
        this.renderAllStock();
    },

    toggleAccordion(id) {
        const el = document.getElementById(id);
        const icon = document.getElementById(`icon-${id}`);
        if (!el) return;

        if (el.classList.contains('hidden')) {
            el.classList.remove('hidden');
            if (icon) icon.classList.add('rotate-180');
        } else {
            el.classList.add('hidden');
            if (icon) icon.classList.remove('rotate-180');
        }
    },

    toggleLotPreview(accordionId, previewLimit, totalLots) {
        const extras = document.querySelectorAll(`.lot-extra-${accordionId}`);
        const toggleBtn = document.getElementById(`lot-toggle-${accordionId}`);
        if (!extras.length || !toggleBtn) return;

        const isExpanded = toggleBtn.dataset.expanded === '1';
        if (isExpanded) {
            extras.forEach(el => el.classList.add('hidden'));
            toggleBtn.dataset.expanded = '0';
            toggleBtn.textContent = `ดูเพิ่มอีก ${Math.max(totalLots - previewLimit, 0)} ล็อต`;
        } else {
            extras.forEach(el => el.classList.remove('hidden'));
            toggleBtn.dataset.expanded = '1';
            toggleBtn.textContent = 'ย่อรายการล็อต';
        }
    },

    // Phase 6: Bottom Sheet & Auto-Confirm
    openBottomSheet(data) {
        const bs = document.getElementById('bottomSheet');
        const overlay = document.getElementById('bottomSheetOverlay');
        const nameInput = document.getElementById('bs_itemName');
        const dateInput = document.getElementById('bs_expiryDate');
        
        if (!bs || !nameInput || !dateInput) return;

        nameInput.value = data.name || "";
        dateInput.value = data.expiryDate || "";
        
        const batchCountEl = document.getElementById('bs_batchCount');
        if (this.pendingReceiptItems && this.pendingReceiptItems.length > 0) {
            batchCountEl.textContent = `+${this.pendingReceiptItems.length} รายการที่เหลือ`;
            batchCountEl.classList.remove('hidden');
        } else {
            batchCountEl.classList.add('hidden');
        }

        overlay.classList.remove('hidden');
        setTimeout(() => bs.classList.add('show'), 10);
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    closeBottomSheet() {
        const bs = document.getElementById('bottomSheet');
        const overlay = document.getElementById('bottomSheetOverlay');
        if (bs) bs.classList.remove('show');
        setTimeout(() => overlay.classList.add('hidden'), 400);
    },

    async addItemDirectly(data) {
        const docId = generateDocId();
        const payload = {
            name: data.name,
            brand: data.brand || '',
            size: data.size || '',
            expiry_date: data.expiryDate,
            category: data.category || "อื่นๆ",
            quantity: 1,
            is_opened: 1,
            price: data.price || 0,
            production_date: new Date().toISOString().split('T')[0]
        };
        
        try {
            await db.collection('items').doc(docId).set(payload);
            this.lastAddedId = docId;
            await this.loadData();
            this.renderList();
        } catch (e) {
            console.error("Direct add failed", e);
        }
    },

    async saveFromBottomSheet() {
        const name = document.getElementById('bs_itemName').value;
        const expiry = document.getElementById('bs_expiryDate').value;
        
        if (!name || !expiry) {
            this.showToast("กรุณากรอกข้อมูลให้ครบถ้วน", "text-red-400");
            return;
        }

        await this.addItemDirectly({ name, expiryDate: expiry });
        this.closeBottomSheet();
        this.showToast("✨ บันทึกเรียบร้อย!", "text-green-400");
        
        // ถ้าเป็นการสแกนบิล ให้ทำรายการถัดไป
        if (this.pendingReceiptItems && this.pendingReceiptItems.length > 0) {
            setTimeout(() => this.processNextReceiptItem(), 500);
        }
    },

    processNextReceiptItem() {
        if (!this.pendingReceiptItems || this.pendingReceiptItems.length === 0) {
            this.showToast("✨ นำเข้าข้อมูลบิลสำเร็จทั้งหมด!", "text-green-500");
            return;
        }
        const item = this.pendingReceiptItems.shift();
        this.openBottomSheet({
            name: item.name,
            expiryDate: item.expiryDate || new Date(Date.now() + 7 * 24 * 3600000).toISOString().slice(0, 16),
            category: item.category || 'อื่นๆ'
        });
    },

    // Scan to Waste (Phase 6 Advanced)
    async handleWasteScan(input) {
        if (!input.files || !input.files[0]) return;
        const file = input.files[0];
        const overlay = document.getElementById('loadingOverlay');
        overlay.classList.remove('hidden');

        try {
            const base64Data = await this.compressImageToBase64(file);
            const prompt = `จากรูปนี้ สินค้าคืออะไร? ให้ตอบกลับในรูปแบบ JSON { "name": "..." } เท่านั้น
                    เราจะทำการหักยอดยอดยอดเสีย (Waste) ออกจากสต๊อก`;

            const responseJson = await this.callGemini(prompt, base64Data);
            let textResult = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!textResult) throw new Error("AI parsing failed");
            
            textResult = textResult.replace(/```json|```/g, '').trim();
            const data = JSON.parse(textResult);

            // หาชื่อสินค้าในสต๊อกที่ใกล้เคียงที่สุด
            const match = this.inventory.find(i => i.name.toLowerCase().includes(data.name.toLowerCase()));
            if (match) {
                await this.logWasteFromScan(match);
                this.showToast(`🗑️ บันทึกทิ้ง: ${match.name} เรียบร้อย`, "text-amber-400");
            } else {
                this.showToast(`ไม่พบสินค้า "${data.name}" ในสต๊อก`, "text-stone-400");
            }
        } catch (e) {
            console.error("Waste scan failed", e);
        } finally {
            overlay.classList.add('hidden');
        }
    },

    async logWasteFromScan(item) {
        const payload = {
            item_name: item.name,
            quantity: 1,
            status: 'scanned_waste',
            date_recorded: new Date().toISOString(),
            price: item.price || 0
        };
        await db.collection('waste_logs').doc(Date.now().toString()).set(payload);
        // ลดจำนวนในสต๊อกลง 1
        if (item.quantity > 0) {
            await db.collection('items').doc(item.id.toString()).update({ quantity: item.quantity - 1 });
        }
        await this.loadData();
        this.renderList();
    },

    // Voice Command (Phase 6)
    startVoice() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            this.showToast("เบราว์เซอร์ไม่รองรับการสั่งงานด้วยเสียง", "text-red-400");
            return;
        }

        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new Recognition();
        this.recognition.lang = 'th-TH';
        this.recognition.interimResults = false;

        document.getElementById('voiceOverlay').classList.remove('hidden');

        this.recognition.onresult = (event) => {
            const text = event.results[0][0].transcript;
            console.log("Captured Voice:", text);
            this.processVoiceToData(text);
        };

        this.recognition.onerror = (e) => {
            console.error("Voice recognition error", e);
            this.stopVoice();
            this.showToast("เกิดข้อผิดพลาดในการรับเสียง", "text-red-400");
        };

        this.recognition.onend = () => {
            // auto-stop overlay if not processed
        };

        this.recognition.start();
    },

    stopVoice() {
        if (this.recognition) this.recognition.stop();
        document.getElementById('voiceOverlay').classList.add('hidden');
    },

    async processVoiceToData(text) {
        const overlay = document.getElementById('loadingOverlay');
        overlay.classList.remove('hidden');
        this.stopVoice();

        try {
            const prompt = `คุณคือผู้ช่วยจัดการสต็อก แปรรูปประโยคนี้เป็นข้อมูลสินค้า: "${text}"
                    หา "ชื่อสินค้า" และ "วันหมดอายุ" (เช่น ถ้าพูดว่าจันทร์หน้า ให้คำนวณวันที่จริงออกมา)
                    
                    ตอบกลับในรูปแบบ JSON เท่านั้น:
                    {
                      "name": "...",
                      "expiryDate": "YYYY-MM-DDTHH:MM",
                      "confidence": 0.95
                    }`;

            const responseJson = await this.callGemini(prompt);
            let textResult = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!textResult) throw new Error("Voice AI parsing failed");

            textResult = textResult.replace(/```json|```/g, '').trim();
            const data = JSON.parse(textResult);

            overlay.classList.add('hidden');
            
            // Unified Review UI for Voice too
            const items = [{
                name: data.name || "",
                quantity: 1,
                unit: "ชิ้น",
                price: 0,
                expiryDate: data.expiryDate
            }];
            App.renderReceiptReview(items);

        } catch (e) {
            console.error("Voice process error", e);
            overlay.classList.add('hidden');
            this.showToast("ไม่สามารถประมวลผลเสียงได้ กรุณาพิมพ์เองครับ", "text-orange-400");
        }
    },

    addBsDays(days) {
        const input = document.getElementById('bs_expiryDate');
        if (!input.value) {
            const d = new Date();
            d.setDate(d.getDate() + days);
            input.value = d.toISOString().slice(0, 16);
        } else {
            const d = new Date(input.value);
            d.setDate(d.getDate() + days);
            input.value = d.toISOString().slice(0, 16);
        }
    },

    showUndoToast(message) {
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 bg-stone-900 text-white px-6 py-4 rounded-2xl shadow-2xl z-[400] flex items-center gap-4 slide-up';
        toast.innerHTML = `
            <span class="text-sm font-bold">${message}</span>
            <button onclick="App.undoLastAction(this)" class="text-amber-400 font-black text-xs uppercase tracking-widest border-l border-white/10 pl-4">ย้อนกลับ</button>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('opacity-0', 'pointer-events-none');
            setTimeout(() => toast.remove(), 500);
        }, 5000);
    },

    async undoLastAction(btnEl) {
        if (!this.lastAddedId) return;
        try {
            await db.collection('items').doc(this.lastAddedId.toString()).delete();
            await this.loadData();
            this.renderList();
            btnEl.parentElement.remove();
            this.showToast("ยกเลิกการบันทึกแล้ว", "text-stone-400");
        } catch (e) {
            console.error("Undo failed", e);
        }
    },

    clearAllStockSearch() {
        this.allStockSearchTerm = '';
        const inp = document.getElementById('allStockSearchInput');
        if (inp) inp.value = '';
        this.renderAllStock();
    },

    setAllStockFilter(filter) {
        this.allStockFilter = filter;
        const container = document.getElementById('allStockFilterContainer');
        if (container) {
            container.querySelectorAll('button').forEach(btn => {
                btn.classList.remove('bg-[#FF6B6B]', 'text-white', 'shadow-md');
                btn.classList.add('bg-white', 'text-stone-600', 'border', 'border-stone-100', 'shadow-sm');
            });
            const idMap = { 'all': 'ast-all', 'นม/ของเหลว': 'ast-นม', 'กาแฟ/ชา': 'ast-กาแฟ', 'ไซรัป': 'ast-ไซรัป', 'อื่นๆ': 'ast-อื่นๆ' };
            const activeBtn = document.getElementById(idMap[filter]);
            if (activeBtn) {
                activeBtn.classList.remove('bg-white', 'text-stone-600', 'border', 'border-stone-100', 'shadow-sm');
                activeBtn.classList.add('bg-[#FF6B6B]', 'text-white', 'shadow-md');
            }
        }
        this.renderAllStock();
    },

    renderAllStockHeatmap() {
        const container = document.getElementById('allStockHeatmap');
        if (!container) return;

        const categories = [...new Set(this.inventory.map(i => i.category || 'อื่นๆ'))];
        const catStats = {};
        const now = new Date();

        categories.forEach(cat => {
            const items = this.inventory.filter(i => i.category === cat);
            let status = 'ok';
            if (items.some(i => (new Date(i.expiryISO) - now) < 0)) status = 'expired';
            else if (items.some(i => (new Date(i.expiryISO) - now) <= (48 * 3600000))) status = 'warning';
            catStats[cat] = status;
        });

        const html = `
            <div class="bg-white/50 backdrop-blur-sm rounded-2xl p-3 border border-stone-100 flex flex-wrap gap-2 justify-center shadow-sm">
                ${categories.map(cat => {
                    let color = 'bg-emerald-500';
                    if (catStats[cat] === 'expired') color = 'bg-red-500 animate-pulse';
                    else if (catStats[cat] === 'warning') color = 'bg-amber-400';
                    return `
                        <div class="flex flex-col items-center gap-1" title="${cat}">
                            <div class="w-6 h-6 rounded-md ${color} shadow-sm"></div>
                            <span class="text-[7px] font-black uppercase text-stone-400 truncate w-6 text-center">${cat.split('/')[0]}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        container.innerHTML = html;
    },

    renderQuickStatusBar() {
        const bar = document.getElementById('quickStatusBar');
        const progress = document.getElementById('statusProgress');
        const label = document.getElementById('statusLabel');
        const percent = document.getElementById('statusPercent');
        if (!bar) return;

        const total = this.inventory.length;
        if (total === 0) { bar.classList.add('hidden'); return; }
        bar.classList.remove('hidden');

        const expired = this.inventory.filter(i => (new Date(i.expiryISO) - new Date()) < 0).length;
        const healthyPercent = Math.round(((total - expired) / total) * 100);

        progress.style.width = `${healthyPercent}%`;
        percent.textContent = `${healthyPercent}%`;

        if (healthyPercent < 70) {
            progress.className = "h-full bg-red-500 animate-pulse transition-all duration-1000";
            label.innerHTML = `สต๊อกวิกฤต! มีของเสื่อมภาพ 🔴`;
            label.className = "text-[9px] font-black uppercase text-red-500";
        } else if (healthyPercent < 100) {
            progress.className = "h-full bg-amber-400 transition-all duration-1000";
            label.innerHTML = `เฝ้าระวัง มีของใกล้หมดอายุ 🟡`;
            label.className = "text-[9px] font-black uppercase text-amber-500";
        } else {
            progress.className = "h-full bg-emerald-500 transition-all duration-1000";
            label.innerHTML = `สถานะสต๊อกปกติ 🟢`;
            label.className = "text-[9px] font-black uppercase text-emerald-500";
        }
    },

    async deleteExpiredInCategory(catName) {
        const expired = this.inventory.filter(i => i.name === catName && (new Date(i.expiryISO) - new Date()) < 0);
        if (expired.length === 0) return;

        if (!confirm(`ยืนยันลบรายการที่หมดอายุใน "${catName}" ทั้งหมด ${expired.length} รายการ?`)) return;

        for (const item of expired) {
            try {
                // Log as wasted
                await db.collection('waste_logs').doc(Date.now().toString() + Math.random().toString().slice(2, 5)).set({
                    date_recorded: new Date().toISOString(),
                    item_name: item.name,
                    quantity: item.quantity || 1,
                    price: item.price || 0,
                    status: 'wasted'
                });
                // Delete from items
                await db.collection('items').doc(item.id.toString()).delete();
            } catch (e) { console.error("Firebase batch delete failed", e); }
        }

        this.showToast(`จัดการลบทิ้ง ${expired.length} รายการสำเร็จ!`, "text-green-400");
        await this.loadInventory();
        this.renderAllStock();
        this.renderList();
    },

    async updateQuantity(id, change) {
        const item = this.inventory.find(i => i.id.toString() === id.toString());
        if (!item) return;
        let newQty = (item.quantity || 1) + change;
        if (newQty <= 0) {
            this.deleteItem(id, item.name);
            return;
        }

        item.quantity = newQty;
        this.renderList();

        try {
            await db.collection('items').doc(id.toString()).update({ quantity: newQty });
        } catch (e) { console.error("Firebase update quantity failed", e); }
    },

    renderDashboard() {
        const container = document.getElementById('executiveDashboard');
        if (!container) return;

        let openedCount = 0;
        let lowStockCount = 0;
        let expiredCount = 0;
        let totalCount = this.inventory.length;
        
        const now = new Date();

        this.inventory.forEach(item => {
            if (item.isOpened) openedCount++;
            
            const exp = new Date(item.expiryISO);
            const diffMs = exp - now;
            const diffHours = Math.floor(diffMs / 3600000);
            
            if (diffHours < 0) expiredCount++;
            else if (diffHours <= 48) lowStockCount++;

            if (!item.isOpened && item.quantity <= (item.min_quantity || 0) && item.quantity > 0) {
                lowStockCount++;
            }
        });

        // Update itemCount pills with X/Y format
        const countText = `${openedCount}/${totalCount} รายการ`;
        const ic = document.getElementById('itemCount');
        const icm = document.getElementById('itemCountMobile');
        if (ic) ic.textContent = countText;
        if (icm) icm.textContent = countText;

        container.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div class="bg-white border-2 border-indigo-100 rounded-[2.5rem] p-5 flex flex-col justify-center shadow-[0_10px_30px_-10px_rgba(79,70,229,0.1)] hover:scale-[1.02] transition-transform">
                    <div class="flex items-center gap-2 mb-2">
                        <div class="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center">
                            <i data-lucide="package-open" class="w-4 h-4 text-indigo-600"></i>
                        </div>
                        <span class="text-[11px] font-black text-indigo-400 uppercase tracking-widest">กำลังใช้งาน</span>
                    </div>
                    <span class="text-4xl font-black text-indigo-700 leading-none">${openedCount} <span class="text-sm text-indigo-300 font-bold">รายการ</span></span>
                </div>
                <div class="relative ${expiredCount > 0 ? 'bg-red-50 border-red-100 shadow-red-100' : (lowStockCount > 0 ? 'bg-amber-50 border-amber-100 shadow-amber-100' : 'bg-emerald-50 border-emerald-100 shadow-emerald-100')} border-2 rounded-[2.5rem] p-5 flex flex-col justify-center shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] hover:scale-[1.02] transition-transform">
                    <!-- AI Scan Button inside widget -->
                    <button onclick="window.location.href='add.html'" class="absolute top-4 right-4 bg-white/80 backdrop-blur border border-stone-100 rounded-2xl px-3 py-2 flex items-center gap-2 shadow-sm hover:bg-white transition-all active:scale-95 group z-20">
                         <span class="hidden sm:inline text-[10px] font-black text-stone-600">รับของเข้า / AI สแกน</span>
                         <div class="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                            <i data-lucide="package-plus" class="w-4 h-4"></i>
                         </div>
                    </button>

                    <div class="flex items-center gap-2 mb-2">
                        <div class="w-8 h-8 rounded-full ${expiredCount > 0 ? 'bg-red-100' : 'bg-stone-100'} flex items-center justify-center">
                            <i data-lucide="alert-triangle" class="w-4 h-4 ${expiredCount > 0 ? 'text-red-600' : 'text-stone-600'}"></i>
                        </div>
                        <span class="text-[11px] font-black ${expiredCount > 0 ? 'text-red-400' : 'text-stone-400'} uppercase tracking-widest">เตือนหมดอายุ</span>
                    </div>
                    <span class="text-4xl font-black ${expiredCount > 0 ? 'text-red-600' : 'text-stone-700'} leading-none">${expiredCount > 0 ? expiredCount : lowStockCount} <span class="text-sm opacity-40 font-bold">รายการ</span></span>
                </div>
            </div>
        `;
        
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    renderList() {
        const container = document.getElementById('inventoryList');
        if (!container) return;

        this.renderDashboard();

        container.innerHTML = '';
        
        // Setup container layout based on viewMode
        if (this.viewMode === 'grid') {
            container.className = "view-grid-items p-4 pb-32";
        } else {
            container.className = "flex flex-col gap-4 p-4 pb-32";
        }

        // Only show opened items on Dashboard
        let filtered = this.inventory.filter(i => i.isOpened);

        // Apply Search Filter
        if (this.searchTerm) {
            filtered = filtered.filter(i => i.name.toLowerCase().includes(this.searchTerm));
        }

        if (this.currentFilter === 'danger') {
            filtered = filtered.filter(i => {
                const exp = new Date(i.expiryISO);
                return (exp - new Date()) <= (12 * 3600000);
            });
        } else if (this.currentFilter !== 'all') {
            filtered = filtered.filter(i => i.category === this.currentFilter);
        }

        const emptyEl = document.getElementById('emptyState');
        if (filtered.length === 0) {
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        } else {
            if (emptyEl) emptyEl.classList.add('hidden');
        }

        // FIFO: Oldest opened first
        filtered.sort((a, b) => {
            const timeA = a.openedAt ? (a.openedAt.seconds ? a.openedAt.seconds * 1000 : new Date(a.openedAt).getTime()) : new Date(a.expiryISO).getTime();
            const timeB = b.openedAt ? (b.openedAt.seconds ? b.openedAt.seconds * 1000 : new Date(b.openedAt).getTime()) : new Date(b.expiryISO).getTime();
            return timeA - timeB;
        });

        const now = new Date();
        
        filtered.forEach(item => {
            const expiry = new Date(item.expiryISO);
            const openedAt = item.openedAt ? (item.openedAt.seconds ? new Date(item.openedAt.seconds * 1000) : new Date(item.openedAt)) : new Date(expiry.getTime() - (7 * 24 * 60 * 60 * 1000));
            
            const diffMs = expiry - now;
            const diffHours = Math.floor(diffMs / 3600000);
            
            const totalFreshnessMs = expiry - openedAt;
            const remainingFreshnessMs = expiry - now;
            let freshnessPercent = totalFreshnessMs > 0 ? (remainingFreshnessMs / totalFreshnessMs) * 100 : 0;
            freshnessPercent = Math.max(0, Math.min(100, freshnessPercent));

            let barColor = 'bg-emerald-500';
            let textColor = 'text-emerald-600';
            if (freshnessPercent < 30) { barColor = 'bg-red-500'; textColor = 'text-red-600'; }
            else if (freshnessPercent < 60) { barColor = 'bg-amber-500'; textColor = 'text-amber-600'; }

            const initial = item.name.charAt(0).toUpperCase();
            const safeName = item.name.replace(/'/g, "\\'");
            const thumb = item.image_url ? 
                `<img src="${item.image_url}" class="${this.viewMode === 'grid' ? 'grid-thumbnail-fix rounded-t-2xl' : 'w-full h-full object-cover rounded-2xl'}" onclick="App.openImageZoom('${item.image_url}', '${safeName}')">` : 
                `<div class="${this.viewMode === 'grid' ? 'grid-thumbnail-fix rounded-t-2xl' : 'w-full h-full rounded-2xl'} bg-stone-100 flex items-center justify-center font-black text-stone-300 text-xl">${initial}</div>`;

            let borderColor = 'border-emerald-500';
            let bgTint = 'bg-emerald-50/30';
            if (freshnessPercent < 30) { borderColor = 'border-red-500'; bgTint = 'bg-red-50/50'; }
            else if (freshnessPercent < 60) { borderColor = 'border-amber-500'; bgTint = 'bg-amber-50/50'; }

            const card = document.createElement('div');
            
            if (this.viewMode === 'grid') {
                // Grid Card Design - Phase 6 (Max Legibility)
                card.className = `bg-white rounded-3xl border-2 ${borderColor} shadow-md overflow-hidden flex flex-col group hover:shadow-lg transition-all duration-300 ${bgTint}`;
                card.innerHTML = `
                    <div class="relative overflow-hidden bg-white shrink-0">
                        ${thumb}
                        <div class="absolute top-2 right-2 bg-white/95 backdrop-blur-md px-2.5 py-1 rounded-xl shadow-md border border-stone-100 flex items-center gap-1">
                             <span class="text-xs font-black ${textColor}">${Math.round(freshnessPercent)}%</span>
                        </div>
                        <div class="absolute bottom-2 left-2 bg-black/50 backdrop-blur-md p-2 rounded-xl text-white shadow-lg">
                             <i data-lucide="${this.getCategoryIcon(item.category)}" class="w-4 h-4"></i>
                        </div>
                    </div>
                    <div class="p-4 flex flex-col flex-1 min-w-0">
                        ${item.brand ? `<span class="text-xs font-black text-indigo-600 uppercase tracking-wide mb-1.5 truncate block">${item.brand}</span>` : ''}
                        <h3 class="text-base font-black text-stone-900 leading-snug mb-2" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; height: 2.8em;" title="${item.name}">${item.name}</h3>
                        
                        <div class="flex flex-col gap-2 mb-4">
                            <div class="flex items-center justify-between text-sm font-bold text-stone-600">
                                <span class="truncate pr-2 bg-stone-100/50 px-2 py-0.5 rounded-lg">${item.size || ''}</span>
                                <span class="text-emerald-700 font-black">${item.price && item.price != 0 ? `฿${item.price}` : ''}</span>
                            </div>
                            <div class="flex items-center gap-2 text-stone-500 font-medium">
                                <i data-lucide="clock" class="w-4 h-4 text-stone-400"></i>
                                <span class="text-xs">${openedAt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
                            </div>
                        </div>

                        <div class="mt-auto pt-3 border-t border-stone-200/50">
                            <button onclick="App.deleteItem('${item.id}', '${safeName}')" class="w-full py-3.5 bg-white hover:bg-red-600 hover:text-white text-stone-700 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 border-2 border-stone-100 shadow-sm active:scale-95">
                                <i data-lucide="check-square" class="w-5 h-5"></i> หมด / ทิ้งแล้ว
                            </button>
                        </div>
                    </div>
                `;
            } else {
                // List Card Design
                card.className = "bg-white rounded-[2rem] border border-stone-100 shadow-sm overflow-hidden flex flex-col group hover:shadow-xl transition-all duration-500";
                card.innerHTML = `
                    <div class="relative h-2 bg-stone-50">
                        <div class="h-full ${barColor} transition-all duration-1000" style="width: ${freshnessPercent}%"></div>
                    </div>
                    <div class="p-5 flex gap-5">
                        <div class="w-20 h-20 shrink-0 relative">
                            ${thumb}
                            <div class="absolute -bottom-1 -right-1 bg-white p-1 rounded-lg shadow-sm border border-stone-50">
                                <i data-lucide="${this.getCategoryIcon(item.category)}" class="w-3 h-3 ${this.getCategoryColor(item.category)}"></i>
                            </div>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="flex justify-between items-start mb-1">
                                <h3 class="text-lg font-black text-stone-800 truncate">${item.name}</h3>
                                <span class="text-[10px] font-bold ${textColor} uppercase tracking-tighter">${Math.round(freshnessPercent)}% Fresh</span>
                            </div>
                            <div class="flex flex-col gap-1">
                                <div class="flex items-center gap-1.5 text-stone-400">
                                    <i data-lucide="clock" class="w-3 h-3"></i>
                                    <span class="text-[10px] font-medium">เปิดเมื่อ: ${openedAt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
                                </div>
                                <div class="flex items-center gap-1.5 ${diffHours < 24 ? 'text-red-500' : 'text-stone-500'}">
                                    <i data-lucide="calendar" class="w-3 h-3"></i>
                                    <span class="text-[10px] font-bold">ควรใช้หมดก่อน: ${expiry.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="px-5 pb-5 mt-auto">
                        <button onclick="App.deleteItem('${item.id}', '${safeName}')" class="w-full py-3 bg-stone-50 hover:bg-red-50 hover:text-red-600 text-stone-400 rounded-2xl font-bold text-xs transition-all flex items-center justify-center gap-2 border border-stone-100">
                            <i data-lucide="check-square" class="w-4 h-4"></i>
                            ใช้หมด / ทิ้งแล้ว
                        </button>
                    </div>
                `;
            }
            container.appendChild(card);
        });

        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    updateOcrProgress(text) {
        const el = document.getElementById('ocrProgress');
        if (el) el.innerHTML = text;
    },

    // ==========================================
    // Image Zoom & View Mode Logic
    // ==========================================
    toggleViewMode() {
        this.viewMode = this.viewMode === 'list' ? 'grid' : 'list';
        localStorage.setItem('cafe_view_mode', this.viewMode);
        this.updateViewModeUI();
        this.renderList();
        if (document.getElementById('allStockContainer')) this.renderAllStock();
        this.showToast(`สลับเป็นมุมมอง ${this.viewMode === 'list' ? 'รายการ' : 'ตาราง'}`, 'text-indigo-400');
    },

    updateViewModeUI() {
        const btn = document.getElementById('btnViewMode');
        if (!btn) return;
        btn.innerHTML = this.viewMode === 'list' ? 
            '<i data-lucide="layout-grid" class="w-4 h-4"></i>' : 
            '<i data-lucide="list" class="w-4 h-4"></i>';
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
        
        const zoomCtrl = document.getElementById('zoomControls');
        if (zoomCtrl) {
            if (this.viewMode === 'grid') zoomCtrl.classList.remove('hidden');
            else zoomCtrl.classList.add('hidden');
        }
    },

    zoomGrid(delta) {
        // Expanded levels for smoother diagonal zoom up to 400px
        const levels = [80, 100, 120, 140, 165, 190, 220, 255, 300, 350, 400];
        let currentIndex = levels.findIndex(l => l >= this.gridZoomSize);
        if (currentIndex === -1) currentIndex = 1;

        let nextIndex = currentIndex + delta;
        if (nextIndex < 0) nextIndex = 0;
        if (nextIndex >= levels.length) nextIndex = levels.length - 1;

        this.gridZoomSize = levels[nextIndex];
        localStorage.setItem('cafe_grid_zoom', this.gridZoomSize);
        this.applyZoom();
        
        // Brief toast to show level
        const labels = ['จิ๋ว', 'เล็กมาก', 'เล็ก', 'ปกติ', 'เริ่มใหญ่', 'กลาง', 'ใหญ่', 'ใหญ่มาก', 'ยักษ์', 'เน้นรูป', 'เต็มจอ'];
        this.showToast(`ขนาดตาราง: ${labels[nextIndex]}`, 'text-indigo-400');
    },

    applyZoom() {
        const width = this.gridZoomSize;
        const height = Math.round(width * 0.75); // Maintain 4:3 or similar proportional growth
        document.body.style.setProperty('--grid-min-width', `${width}px`);
        document.body.style.setProperty('--grid-img-height', `${height}px`);
    },

    openImageZoom(url, name) {
        const modal = document.getElementById('imageZoomModal');
        const img = document.getElementById('zoomedImage');
        const nameEl = document.getElementById('zoomedImageName');
        if (!modal || !img) return;

        img.src = url;
        if (nameEl) nameEl.textContent = name;
        
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.add('show'), 10);
        if(typeof lucide !== "undefined") { try { lucide.createIcons(); } catch(e){} }
    },

    closeImageZoom() {
        const modal = document.getElementById('imageZoomModal');
        if (!modal) return;
        modal.classList.remove('show');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());
