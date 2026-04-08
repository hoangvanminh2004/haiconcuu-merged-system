# HAI CON CUU - BAN GOP 1 DOMAIN

Cau truc:
- server.js                -> dat o thu muc goc
- public/index.html        -> giao dien trang chu + dang nhap + he thong
- package.json
- .env.example
- render.yaml

## Muc tieu
Dung 1 domain duy nhat, vi du:
- https://haiconcuu.vn

Trang chu:
- Gioi thieu doanh nghiep
- Nut dang nhap he thong o goc

Sau khi dang nhap:
- He thong xin nghi
- He thong dang ky phong van
- Quan ly ho so
- Quan ly tai khoan
- Phan quyen theo vai tro

## Cach day len Render
1. Tao 1 Web Service moi tren Render tu GitHub
2. Upload bo file nay len repo
3. Bao dam public/index.html va server.js dung vi tri
4. Tao PostgreSQL tren Render
5. Gan bien moi truong:
   - DATABASE_URL
   - DB_SSL=true
   - SESSION_SECRET
   - ADMIN_USERNAME
   - ADMIN_PASSWORD
   - ADMIN_FULL_NAME
6. Deploy

## Gan domain haiconcuu.vn
1. Vao service tren Render
2. Settings -> Custom Domains
3. Them haiconcuu.vn va www.haiconcuu.vn
4. Tro DNS theo Render huong dan:
   - root domain: A/ALIAS/ANAME tuy nha cung cap
   - www: CNAME
5. Cho DNS cap nhat
6. Bat HTTPS tren Render

## Ghi chu
- Ban nay la bo gop 1 domain: trang chu va he thong dung chung mot website
- Muon vao he thong thi bam Dang nhap o goc phai
- Sau khi dang nhap se vao app quan ly noi bo
