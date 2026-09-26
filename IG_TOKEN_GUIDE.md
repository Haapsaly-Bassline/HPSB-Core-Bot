# Instagram для бота — вечное решение (бесплатно, без подписок)

Анонимный скрап по нику (как «у всех») в 2026 душится самим Instagram:
429, логин-стены, CF. Наш бот и так идёт по цепочке
Graph → web_profile (твоя кука) → HTML → RSSHub и ретраит сам,
плюс дёргает IG раз в 30 мин (`IG_POLL_MINUTES`), чтобы не словить бан по частоте.
Но гарантированный вариант один — официальный токен бизнес-аккаунта:

## Шаги (15 минут, один раз)
1. https://developers.facebook.com → Create App → тип **Business**.
2. В настройках App: Products → Add → **Instagram Graph API** (и Messenger не нужен).
3. Привяжи Facebook Page, связанную с `hps_bassline`
   (Page Settings → Linked accounts → Instagram, или наоборот из IG:
   Настройки → Аккаунт → Связанные аккаунты → Facebook).
4. Graph API Explorer (developers.facebook.com/tools/explorer):
   выбери свой App → User Token → добавь права
   `instagram_basic`, `pages_show_list`, `pages_read_engagement`.
5. Запрос: `GET /me/accounts` → найди свою Page → возьми её `access_token`.
6. Продли до long-lived (60 дней):
   `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...`
7. Узнай IG business ID: `GET /{page-id}?fields=instagram_business_account` → `id`.
8. В `.env` бота:
   ```
   IG_GRAPH_TOKEN=<long-lived token>
   IG_BUSINESS_ID=<id>
   ```
9. Рестарт бота. В логе должно пропасть `[ig] login_required`,
   метод станет `graph` (видно в `/reposter-status`? нет — в логе `[reposter/ig] new ... (graph)`).

Токен живёт 60 дней — потом повтори шаг 6 (2 минуты). Автопродление докрутим позже при желании.
