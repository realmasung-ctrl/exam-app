# ระบบสอบออนไลน์ (Online Exam App)

สถานะ: **Phase 3 เสร็จ** — Admin ล็อกอิน, จัดการชุดข้อสอบ/คำถาม, ตรวจความครบถ้วน, ดูตัวอย่าง, เพิ่มผู้ดูแล
ยังไม่มี: รอบสอบ/ลิงก์/QR (Phase 4), หน้าผู้เรียน (Phase 5–7), ผลสอบ/ส่งออก (Phase 8)

## ทดสอบความถูกต้องในเครื่องผม (ผ่านแล้ว)
- `npm test` → ทดสอบ validation 7 รายการ (Node 22+ รัน .ts ได้เลย ไม่ต้องติดตั้งแพ็กเกจ)
- โค้ดหน้าเว็บ **ยังไม่เคย build/รันจริง** (เครื่องผมติดตั้งแพ็กเกจไม่ได้) ต้องให้คุณ deploy แล้วลองตามด้านล่าง

## ตั้งค่า Supabase (ถ้าทำ Phase 1–2 แล้ว ข้ามข้อ 1)
1. รัน migration 0001–0003 (ดูรายละเอียดในรอบก่อน)
2. **ปิดการสมัครเอง**: Dashboard → Authentication → Sign In / Providers → ปิด “Allow new users to sign up”
3. เก็บค่า 3 ตัวจาก Project Settings → API: Project URL, anon key, service_role key (**ห้ามเปิดเผย service_role**)

## สร้างผู้ดูแลคนแรก (เลือกวิธีใดวิธีหนึ่ง)
**วิธี ก — ไม่ต้องติดตั้งอะไรในเครื่อง**
1. Dashboard → Authentication → Users → Add user → Create new user → ใส่อีเมล + รหัสผ่าน (≥10 ตัว) และติ๊ก Auto Confirm User
2. คัดลอก User UID ของผู้ใช้นั้น แล้วรันใน SQL Editor:
```sql
insert into public.admin_profiles (id, display_name)
values ('วาง-UID-ตรงนี้', 'ชื่อที่ต้องการแสดง');
```
**วิธี ข — มี Node.js**: `npm run create-admin -- you@example.com 'รหัสผ่าน' 'ชื่อ'` (ต้องมี .env.local)

## Deploy ขึ้น Vercel (ไม่ต้องรันในเครื่อง)
1. สร้าง repository บน GitHub แล้วอัปโหลดไฟล์ในโฟลเดอร์ `exam-app` ทั้งหมด (อย่าอัปโหลดไฟล์ `.env.local`)
2. vercel.com → Add New → Project → เลือก repo → Framework: Next.js (ตรวจพบเอง)
3. ก่อนกด Deploy ใส่ Environment Variables:

| ชื่อ | ค่า |
|---|---|
| `SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (ค่าเดียวกัน) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `NEXT_PUBLIC_APP_URL` | `https://ชื่อโปรเจกต์.vercel.app` (ใส่หลัง deploy ครั้งแรกแล้ว redeploy ก็ได้) |
| `CRON_SECRET` | ข้อความสุ่มยาว ๆ |

4. Deploy → เปิด `https://ชื่อโปรเจกต์.vercel.app/admin` → ล็อกอินด้วยบัญชีที่สร้างไว้

## เช็กลิสต์ทดสอบ Phase 3 (ทำตามแล้วแจ้งผลได้เลย)
- [ ] ล็อกอินด้วยรหัสผิด → ขึ้นข้อความผิดพลาด ; รหัสถูก → เข้าหน้าหลัก
- [ ] เปิด `/admin/sets` ตอนยังไม่ล็อกอิน (หน้าต่างไม่ระบุตัวตน) → เด้งไปหน้าล็อกอิน
- [ ] สร้างชุดข้อสอบ → เพิ่ม 3 ข้อ → กรอกคำถาม ก ข ค ง เลือกเฉลย → บันทึก → ข้อนั้นแถบซ้ายเป็นสีเขียว
- [ ] ปล่อยข้อหนึ่งว่าง/ไม่เลือกเฉลย → กล่องสีเหลืองบอกว่าต้องแก้อะไร
- [ ] เลื่อนข้อขึ้น/ลง, ลบข้อ (เลขข้อต้องเรียงต่อกัน)
- [ ] สลับเป็น “กำหนดคะแนนแยกแต่ละข้อ” → ช่องคะแนนรายข้อปรากฏ ; คะแนนเต็มที่หัวหน้าเปลี่ยนตาม
- [ ] “ดูตัวอย่างข้อสอบ” → ทำเหมือนผู้เรียน และไม่เห็นเฉลย
- [ ] ตั้งค่าระบบ → สร้างผู้ดูแลคนที่สอง → ล็อกอินด้วยบัญชีนั้นได้ และเห็นชุดข้อสอบเดียวกัน
- [ ] บัญชีที่สร้างใน Supabase แต่ **ไม่มี** admin_profiles ล็อกอินแล้วต้องถูกปฏิเสธ
