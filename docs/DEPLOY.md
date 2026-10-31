# คู่มือติดตั้ง ตั้งค่า และ Deploy (ตั้งแต่ศูนย์)

ใช้เมื่อ (ก) ติดตั้งระบบครั้งแรก หรือ (ข) ย้ายไปโปรเจกต์ Supabase/Vercel ใหม่ ชื่อเมนูของ Supabase/Vercel/GitHub อาจเปลี่ยนเล็กน้อยตามเวลา ให้หาเมนูที่ความหมายใกล้เคียงที่สุด

## 0. ภาพรวมสถาปัตยกรรม
```
ผู้เรียน/แอดมิน (เบราว์เซอร์)  →  Vercel (Next.js: หน้าเว็บ + API)  →  Supabase (PostgreSQL + Auth)
                                         ↑ ตรวจสิทธิ์ทุกคำขอ              ↑ pg_cron ส่งข้อสอบที่หมดเวลาทุก 1 นาที
```
เบราว์เซอร์ไม่คุยกับฐานข้อมูลโดยตรง ตารางทั้งหมดถูกล็อก มีแต่เซิร์ฟเวอร์ (service_role key) ที่เข้าถึงได้

## 1. บริการที่ต้องสมัคร (ฟรีทั้งหมด)
| บริการ | ใช้ทำอะไร | หมายเหตุ |
|---|---|---|
| GitHub | เก็บโค้ด ให้ Vercel ดึงไป build | สร้าง repository แบบ **Private** |
| Supabase | ฐานข้อมูล + ระบบล็อกอินแอดมิน | เลือก Region **Singapore** |
| Vercel | เปิดเว็บให้คนทั่วไปเข้าได้ | แพ็กเกจ Hobby ; เงื่อนไขระบุว่าเป็นการใช้ส่วนบุคคล/ไม่ใช่เชิงพาณิชย์ ตรวจเงื่อนไขล่าสุดก่อนใช้ในองค์กร |

แนะนำเปิดการยืนยันตัวตนสองชั้น (2FA/MFA) ให้บัญชีทั้งสามนี้ เพราะใครเข้าบัญชีเหล่านี้ได้ก็เข้าระบบและข้อมูลได้ทั้งหมด

## 2. ตั้งค่า Supabase
1. New project → ตั้งชื่อ → **Region: Singapore** → ตั้งรหัสผ่านฐานข้อมูล (**จดเก็บไว้**) → Create
2. Database → Extensions → เปิด **pg_cron**
3. SQL Editor → รันไฟล์ใน `supabase/migrations/` **ตามลำดับ ทีละไฟล์** (เปิดไฟล์ → คัดลอกทั้งหมด → New query → วาง → Run → ต้องได้ "Success")
   `0001_schema.sql` → `0002_functions.sql` → `0003_security_cron.sql` → `0004_session_cap.sql` → `0005_save_set_content.sql`
4. ทดสอบฐานข้อมูล (ผลที่ถูกต้องดู `docs/SECURITY_TEST.md`): `supabase/tests/smoke.sql`, `security.sql`, `edge-cases.sql`, `save-set-content.sql`
5. Authentication → Sign In / Providers → **ปิด “Allow new users to sign up”**
6. Project Settings → API (หรือ Data API / API Keys) จด 3 ค่า: **Project URL**, **anon/publishable key**, **service_role/secret key** (ห้ามเปิดเผย ห้ามใส่ในโค้ด)

## 3. สร้างผู้ดูแลคนแรก
1. Authentication → Users → Add user → Create new user → ใส่อีเมล + รหัสผ่าน (อย่างน้อย 10 ตัว) → ติ๊ก **Auto Confirm User**
2. คัดลอก **User UID** แล้วรันใน SQL Editor
```sql
insert into public.admin_profiles (id, display_name) values ('วาง-UID-ตรงนี้', 'ชื่อที่แสดง');
```
ผู้ดูแลคนถัดไป: เข้าระบบ → เมนู “ตั้งค่าระบบ” → เพิ่มผู้ดูแลระบบ

## 4. อัปโหลดโค้ดขึ้น GitHub
1. GitHub → New repository (Private) ไม่ต้องติ๊ก README
2. “uploading an existing file” → ลาก **เนื้อหาข้างใน** โฟลเดอร์ `exam-app` ทั้งหมด (ไม่ใช่ตัวโฟลเดอร์) ไปวาง ใช้ Chrome/Edge → Commit
3. ตรวจว่า `package.json` อยู่ชั้นนอกสุดของ repo และไม่มีไฟล์ `.env*` ที่ใส่ค่าจริง

## 5. Deploy บน Vercel
1. vercel.com → ล็อกอินด้วย GitHub → Add New → Project → Import repo → Framework: **Next.js**
2. Environment Variables (ก่อนกด Deploy)

| Key | Value | Type |
|---|---|---|
| `SUPABASE_URL` | Project URL | Secret/Config ได้ |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (ค่าเดียวกัน) | **Config** (Vercel เตือนถ้าเลือก Secret) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/publishable key | **Config** |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role/secret key | **Secret** — ห้ามขึ้นต้นด้วย NEXT_PUBLIC_ |
| `NEXT_PUBLIC_APP_URL` | `https://ชื่อเว็บของคุณ.vercel.app` (ไม่มี `/` ท้าย) | **Config** |
| `CRON_SECRET` | ข้อความสุ่มยาว ≥ 30 ตัว | **Secret** |

   (ก่อน deploy ครั้งแรกยังไม่รู้ที่อยู่เว็บ ให้ใส่ค่าชั่วคราวแล้วแก้หลัง deploy ครั้งแรก จากนั้น **Redeploy** — ตัวแปรใหม่มีผลหลัง Redeploy เท่านั้น)
3. Deploy → รอ Ready (1–3 นาที) ; ถ้า build ล้ม คัดลอกบรรทัดสีแดงในบันทึก build
4. Settings → Functions → **Function Region = Singapore (sin1)** → Redeploy (ลดความช้าจากระยะทางไปฐานข้อมูล)
5. ตรวจว่า Settings → Cron Jobs มีงาน `/api/health` ทำงานรายวัน (กำหนดใน `vercel.json`) — ใช้ปลุกฐานข้อมูลไม่ให้ถูกหยุดจากไม่มีการใช้งาน

## 6. ตรวจรับหลังติดตั้ง
1. เปิด `https://เว็บของคุณ/` → ต้องเห็นปุ่ม “เข้าสู่ระบบผู้ดูแล” → ล็อกอินสำเร็จ
2. เมนู **ตรวจสอบระบบ / สำรองข้อมูล** → ทุกรายการต้องเป็น ✅ (⚠️ ที่ไม่เกี่ยวกับความปลอดภัยพิจารณาตามเหตุผลที่แสดง)
3. รัน `supabase/tests/security.sql` ใน SQL Editor → `✅ ALL SECURITY CHECKS PASSED`
4. ทำตาม `docs/ACCEPTANCE.md`

## 7. อัปเดตระบบเมื่อมีเวอร์ชันใหม่
1. แตกไฟล์ซิปเวอร์ชันใหม่ ดูรายการ “ไฟล์ใหม่/ที่แก้” และ “ต้องรัน SQL หรือไม่” ท้าย `README.md`
2. **สำรองข้อมูลก่อนเสมอ** (เมนูตรวจสอบระบบ / สำรองข้อมูล)
3. ถ้ามี migration ใหม่ รันใน SQL Editor ก่อนหรือหลังอัปโหลดตามที่ README ระบุ
4. GitHub → Add file → Upload files → ลาก `app`, `components`, `lib`, `tests`, `scripts`, `supabase`, `docs` + ไฟล์ที่ราก (`README.md`, `package.json`, `next.config.mjs`) → Commit
5. Vercel build ใหม่เอง รอ Ready แล้วตรวจที่เมนูตรวจสอบระบบ
6. ถ้าเวอร์ชันใหม่มีปัญหา: Vercel → Deployments → เลือกรายการก่อนหน้าที่เป็น Ready → ⋯ → **Promote to Production** (ย้อนโค้ดได้ แต่ย้อน migration ของฐานข้อมูลไม่ได้ ถ้าจำเป็นให้กู้จากไฟล์สำรอง)

## 8. ใช้โดเมนของตัวเอง (ไม่บังคับ)
Vercel → Settings → Domains → Add → ทำตามที่แสดง (ตั้ง DNS ที่ผู้ให้บริการโดเมน) ระวัง: **เปลี่ยนที่อยู่แล้วลิงก์/QR ที่แจกไปแล้วจะใช้ไม่ได้** ให้เพิ่มโดเมนใหม่เป็นโดเมนเสริม (คงที่อยู่เดิมไว้) แล้วแก้ `NEXT_PUBLIC_APP_URL` + Redeploy ก่อนสร้าง QR รอบต่อไป

## 9. ค่าใช้จ่ายและข้อจำกัดของแพ็กเกจฟรี (ตรวจหน้าราคาจริงอีกครั้งก่อนใช้งาน)
| เรื่อง | แพ็กเกจฟรี | ผลกับระบบนี้ |
|---|---|---|
| Supabase: สำรองข้อมูลอัตโนมัติ | **ไม่มี** (มีในแพ็กเกจเสียเงิน) | ต้องดาวน์โหลดไฟล์สำรองเอง (ดู OPERATIONS.md) |
| Supabase: หยุดโปรเจกต์ถ้าไม่มีการใช้งานนาน (ประมาณ 1 สัปดาห์) | มี | ปลุกด้วย cron รายวัน ; ถ้าถูกหยุด กดเปิดใหม่ใน Dashboard ข้อมูลไม่หาย |
| Supabase: ขนาดฐานข้อมูล | จำกัด (ระบบนี้ใช้น้อยมาก เป็นข้อความล้วน) | ลบรอบสอบเก่าที่ส่งออกแล้วได้ |
| Vercel Hobby: ใช้เชิงพาณิชย์ | ไม่อนุญาต | องค์กรใช้ฝึกอบรมภายในโดยไม่เก็บเงินน่าจะเข้าข่าย แต่ควรอ่านเงื่อนไขเอง ทางเลือก: Vercel Pro (~20 USD/เดือน) |
| Vercel: เวลารันต่อคำขอ/ขนาดตอบกลับ | มีขีดจำกัด | การสำรองข้อมูลทำแบบสตรีม ; ถ้าข้อมูลมากจนดาวน์โหลดไม่สำเร็จ ให้ส่งออกรายรอบเป็น Excel แล้วลบรอบเก่า |
| ผู้เข้าสอบพร้อมกัน | ไม่เกิน 50 คนผ่านการทดสอบโหลด (ดู SECURITY_TEST.md) | เพียงพอ |

## 10. เปลี่ยนกุญแจที่รั่ว
- สงสัยว่า `SUPABASE_SERVICE_ROLE_KEY` รั่ว: สร้างกุญแจใหม่ใน Supabase (Project Settings → API) → แก้ใน Vercel Environment Variables → Redeploy → ตรวจสอบว่ากุญแจเก่าใช้ไม่ได้แล้ว
- สงสัยว่ามีคนเข้าบัญชีแอดมิน: เปลี่ยนรหัสผ่านทันที (ตั้งค่าระบบ) ; ตรวจรายชื่อผู้ดูแลว่ามีคนแปลกปลอมไหม (ตั้งค่าระบบ → ผู้ดูแลระบบ)
