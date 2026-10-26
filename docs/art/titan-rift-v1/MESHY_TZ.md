# «Титаны: Разлом»: ТЗ на 3D-модели (Meshy) v1

Стиль: `STYLE_BRIEF.md` рядом. Концепт: `docs/art/concept-v02/titans_*.webp`. Платные операции Meshy запускаются только после согласования цены с владельцем; ниже — оценка, точную цену называю перед запуском.

## Требования ко всем ассетам
- glTF/GLB, метры, Y вверх; текстуры WebP; один материал на ассет, где возможно; без normal map для мелочей.
- Названия файлов и узлов латиницей, как в текущих комплектах.
- К каждому пакету: превью-PNG, `MANIFEST` (треугольники, размеры, байты), короткий `QA` (что проверено).

## 1. Титаны (ростер из 6 на общем скелете, см. `ROSTER.md`)
**Обновлено 2026-10-27:** образцы делаются в ChatGPT по `ROSTER.md`; в Meshy только 3D по готовому образцу (30) и скелет (5), анимации один раз (около 21) и переносятся на всех в коде. Промпты «Борея» и «Пироса» ниже устарели.
| Требование | Значение |
|---|---|
| Рост | около 3,2 м (как нынешний titan-v04), стоит на клетке 2,8 м |
| Треугольники | 4–8 тыс. |
| Скелет | тот же, что у titan-v04: имена костей без `mixamorig:`, цепочка `Hips → Spine02 → Spine01 → Spine`, кость `RightHand` с узлом-сокетом `HandStone` под камень |
| Клипы (точные имена) | `Idle`, `Walk`, `ThrowWindup` (около 1,2 с), `ChargeHold` (петля), `ThrowRelease` (выпуск на 0,333 с); желательно ещё `Run`, `Jump`, `Hit`, `Fall` (кувырок), `Victory`, `Repair` |
| Текстура | один атлас 1024 (base color, без normal, если можно) |
| Лицо | крупные глаза; мимика через 3 варианта текстуры лица или blend shapes (`Neutral`, `Shock`, `Joy`) |

**Титан А «Борей»** (бирюзовый). Промпт:
```
Stylized 3D game character, chubby clumsy bean-shaped demigod titan, big head, very big hands and forearms, short legs, round belly, fluffy white beard and hair, golden laurel wreath, teal toga with gold meander trim, gold belt with round medallion, gold bracers, leather sandals, big expressive eyes, friendly heroic face, Supercell / Fall Guys style, soft stylized PBR, high roughness, clean simple shapes, T-pose, front view, plain background
```
Вход для image-to-3D: вырез левого титана из `titans_menu.webp`.

**Титан Б «Пирос»** (коралловый). Промпт:
```
Stylized 3D game character, stocky bean-shaped fire titan, taller than wide, big hands, short legs, flame-shaped orange-red beard and hair, bronze bracers and shoulder plate, red toga with dark gold trim, leather belt with hammer-shaped buckle, big expressive eyes with bushy eyebrows, cheeky confident face, Supercell / Fall Guys style, soft stylized PBR, high roughness, clean simple shapes, T-pose, front view, plain background
```

## 2. Комплект плит «Олимп» (`platform-skins-v01/olympus/`)
Повторяет устройство нынешних комплектов, тогда он подключится без изменений кода (`shared/platformKits.ts`, `client/play/platform.ts`):

| Файл | Что | Бюджет |
|---|---|---|
| `tile_a_intact`, `tile_b_intact`, `tile_c_intact` | мраморная плита 2,8 × 2,8 м: целая / со сколами / с прожилками | до 300 треугольников |
| `tile_{a,b,c}_{f0,f1,f2}_cracked` | 3 рисунка трещин, щели под золотое свечение (отдельный emissive-материал или маска) | до 400 |
| `tile_{a,b,c}_{f0,f1,f2}_fragments` | обломки для разлёта | до 400 |
| `underrock_1..3` | низ острова: скала, корни, мох; один вариант с водопадом | до 2 тыс. |
| `edge_teal`, `edge_coral` | мраморная кайма с меандром, золото и линия цвета команды | до 600 |
| `corner_rect90_teal`, `corner_rect90_coral` | угловой постамент (база колонны, чаша с огнём) | до 800 |
| `textures/` | общие атласы комплекта WebP 1024 | 3 материала на комплект |

Промпт для плиты:
```
Stylized game floor tile, square 2.8 x 2.8 m, ivory marble slab with soft rounded bevel, subtle veins, thin gold inlay line near the edge, Supercell style, soft stylized PBR, high roughness, top-down readable, low poly
```

## 3. Декор острова (новый слой, нужна доработка кода)
Колонна целая и обломанная, знамя команды (ткань без физики), куст и плющ, ваза, кучка обломков. До 600 треугольников каждый, общий атлас 1024. Ставится по периметру, вне клеток.

## 4. Снаряд и арсенал
- **Метеор-камень:** до 300 треугольников, тёмный камень с маской золотых трещин (emissive).
- **Арсенал:** мраморный постамент с золотым кольцом и грудой из 5–7 камней, до 1,5 тыс.

## 5. Фон (картинка, не модель)
Рисованный фон 2:1, 2048 × 1024 WebP. Делать в генераторе картинок по концепту, не в Meshy:
```
Painted fantasy sky backdrop, 2:1 panorama, golden sunset over a sea of clouds, distant floating islands with white marble temples and waterfalls, a giant ancient titan statue far away, soft god rays, warm peach gold and lilac palette, Supercell style, no characters, no text, no UI
```

## Оценка Meshy (ориентир, уточню перед запуском)
По журналу прошлого пакета Codex: 17 задач — 323 кредита, около 19 кредитов на задачу. На титана уходит генерация + ремеш + риггинг + анимации (несколько задач); на комплект плит и декор — около 15–25 генераций.
- **Титаны:** 2 × (генерация + ремеш + риг + 6–10 клипов). Оценю отдельно, когда проверю нынешние цены Meshy.
- **Плиты, декор, камень:** около 15–25 генераций, примерно 300–500 кредитов.

Порядок: сначала один титан (А) — проверяем пропорции, риг и вид в игре. Потом титан Б, комплект «Олимп», декор.
