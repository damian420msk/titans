# «Титаны: Разлом»: ростер титанов v1 и промпты образцов

Согласовано с владельцем 2026-10-27. Титаны — не олимпийские боги: первородные великаны стихий, старше богов. Боги = тоги, лавры, мрамор; титаны = камень, стихия, первобытный декор. Образец «Борея» (`D:\Titans_3D\titan-rift-v1\borey\01_reference_tpose.png`, 6 кредитов) получился богом, а не титаном; он отложен как будущая линейка скинов «Олимпийцы».

## Визуальный язык титана
- **Тело стихии:** в коже проступают камень, кристаллы, кора, лава или звёзды — у каждого своя стихия.
- **Первобытный декор:** грубые бронзовые обручи, цепи, каменные бусы, кожаные ремни, резные кости, повязки и шкуры. Босые ноги. Никаких лавров и тог.
- **Силуэт:** ноги-тумбы, огромные плечи и кулаки, шея почти не видна, каменные наросты на плечах. При этом пухлый и смешной: большая голова (около 1/3,5 роста), крупные выразительные глаза, живая мимика.
- **Есть титаниды** (женщины-титаны): аудитория 6–60.
- **Читаемость:** силуэт узнаётся в 40 px на телефоне; у соперника цвет команды даёт кольцо и кайма острова, поэтому сам титан может быть любого цвета.

## Лестница редкости (один скелет, одни движения)
| Ранг | Цена (монеты) | Что видно глазом |
|---|---|---|
| Стартовый | 0 | простое тело одной фактуры, минимум деталей, повязка — явный «новичок» |
| Обычный | ~200 | стихия в теле + 1–2 крупных аксессуара |
| Редкий | 400–500 | броня или украшения, свечение прожилок, крупная деталь силуэта |
| Легендарный | 600–1000 | особый силуэт (пламя вместо волос, звёздная кожа), эффекты и частицы в игре |

Каждая ступень заметно «богаче» предыдущей: больше света, золота, деталей силуэта, эффектов. Дешёвый ряд позже пополняется вариантами тех же моделей (перекраска, другая голова, аксессуар).

**Бот берёт случайного титана** из всего ростера: игрок видит дорогих в бою до покупки («примерка»); в магазине — пометка «встречался тебе в бою».

## Первая шестёрка
| # | Имя | Ранг, цена | Стихия и образ |
|---|---|---|---|
| 1 | **Новичок** | стартовый, 0 | глиняно-каменный титан-подросток, повязка из верёвки, пара трещинок, без украшений |
| 2 | **Атлас** | обычный, 200 | каменные плечи и спина, носит небольшой валун-«небосвод» на спине, кожаные ремни |
| 3 | **Океан** | обычный, 200 | бирюзово-синяя кожа с ракушками, кораллы на плечах, борода из водорослей, якорная цепь на поясе |
| 4 | **Тейя** | редкий, 400 | титанида света: тёплая бронзовая кожа с золотыми сияющими прожилками, косы с солнечными дисками, лёгкая каменная броня |
| 5 | **Прометей** | редкий, 600 | огненные волосы и борода, раскалённые кулаки с трещинами лавы, кузнечный фартук, наручи из обсидиана |
| 6 | **Кронос** | легендарный, 1000 | титан времени: тёмная звёздная кожа (созвездия), каменные песочные часы на поясе, серп-полумесяц за спиной, седая борода с искрами |

## Как делать образцы (ChatGPT / генератор картинок)
1. Для каждого титана один запрос = один лист: **анфас в строгой позе T** и рядом **вид в три четверти**, на белом фоне.
2. В начало каждого запроса вставлять **общий стилевой блок** — тогда шестёрка выглядит одной семьёй.
3. Сохранять в `D:\Titans_3D\titan-rift-v1\<имя>\reference.png`, лучшие варианты присылать мне.
4. Только после утверждения образца — Meshy: 3D по образцу (30 кредитов) и скелет (5). Анимации покупаются один раз (около 21 кредита) и переносятся на всех в коде: скелет у всех один.

Оценка на шестерых: 6 × 35 + 21 ≈ 230 кредитов (баланс 498 на 2026-10-27).

### Общий стилевой блок (вставлять первым)
```
Character design sheet for a stylized 3D mobile game (Supercell / Fall Guys quality, soft stylized PBR, high roughness, warm rim light, clean simple readable shapes).
These are TITANS, primordial elemental giants older than the Olympian gods — NOT Greek gods: no togas, no laurel wreaths, no marble temples. Primal look: elemental matter showing through the skin (stone, crystal, lava, water, stars), rough bronze rings, chains, stone beads, leather straps, carved bone, loincloths and hides, bare feet.
Body: chubby, heavy and funny — big head (about 1/3.5 of height), huge shoulders, very big fists and forearms, short pillar-like legs, almost no neck, round belly, big expressive cartoon eyes and lively face.
Layout: two views side by side on a plain pure white background — LEFT: full body front view in a strict T-pose (arms straight out horizontally, palms down, legs slightly apart, empty hands); RIGHT: the same character in a relaxed 3/4 view. Whole body visible head to feet, no text, no logo, no scenery.
```

### 1. Новичок (стартовый)
```
[STYLE BLOCK]
Character: "Rookie", a young beginner titan made of plain reddish-brown clay and stone, smooth surface with a few small cracks, simple rope belt and a short cloth loincloth, bare feet, no jewelry, no glow. Cheerful, eager, slightly clumsy expression, short tuft of stony hair. Deliberately simple: the starter character.
```

### 2. Атлас (обычный)
```
[STYLE BLOCK]
Character: "Atlas", a sturdy grey granite titan: rocky plates on shoulders and back, a small round boulder strapped to his back with thick leather straps (the 'sky' he carries), simple bronze arm rings, short dark beard of stone chips, determined proud face. Earthy grey and brown palette with one bronze accent.
```

### 3. Океан (обычный)
```
[STYLE BLOCK]
Character: "Oceanus", a sea titan with turquoise-blue skin, barnacles and small seashells on the shoulders, pink coral growths on one shoulder, long green seaweed beard and hair, a rusty anchor chain as a belt, wet glossy highlights. Jolly, booming, friendly face.
```

### 4. Тейя (редкий)
```
[STYLE BLOCK]
Character: "Theia", a titaness of light: warm bronze skin with softly glowing golden veins, two thick braids decorated with small golden sun discs, light carved stone armor plates on shoulders and chest, golden arm cuffs, short leather skirt with stone beads. Confident, kind, slightly mischievous face. Strong but charming, not sexualized.
```

### 5. Прометей (редкий)
```
[STYLE BLOCK]
Character: "Prometheus", a fire titan: hair and beard made of stylized flames (orange to yellow), dark charcoal skin with glowing lava cracks on the fists and forearms, heavy black obsidian bracers, a leather blacksmith apron with bronze rivets. Fiery, cheeky grin.
```

### 6. Кронос (легендарный)
```
[STYLE BLOCK]
Character: "Kronos", the legendary titan of time: deep midnight-blue skin covered with faintly glowing constellations and star sparkles, long silver beard with tiny sparks, a stone hourglass hanging from a heavy chain belt, a big crescent-moon sickle shape on his back (decorative, not a weapon in hand), ancient bronze shoulder ornaments. Wise, sly, majestic but still funny face.
```

## Связь с игрой
- Модели заменяют нынешних `titans-v04` и `titans-red-v01`; список в `shared/titans.ts` растёт до ростера, в магазине вкладка «Титан» получает цены по рангам.
- Сторона различается кольцом и каймой цвета команды, поэтому два одинаковых титана в бою возможны, но бот по умолчанию берёт другого.
