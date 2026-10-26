# Стилизованные 3D-стили, которые выглядят «дорого» и реально работают в WebGL (Babylon.js) на слабых телефонах и ПК

Контекст: дуэль 1 на 1, два летающих островка из плиток (сетка 9x11), камера за спиной игрока смотрит на остров врага, два персонажа, снаряды, разрушаемые плитки, фон из неба и облаков. Babylon.js 9, мобильная политика качества уже есть. Команда: один разработчик и ИИ-генерация 3D через Meshy.

Примечание о качестве источников: по стилям Supercell и Mediatonic в открытом доступе почти нет технических разборов (только интервью и маркетинг). Доклад GDC «Making of a Brawler» про Brawl Stars лежит в GDC Vault, его содержимое получить не удалось. Цифровые бюджеты по WebGL в основном берутся из документации движков (PlayCanvas, Babylon, Unity) и из форумов. Всё, что помечено **[эмпирическое правило]**, является практическим ориентиром, а не измеренным фактом.

## 1. Какие стили используют успешные массовые 3D-игры и что определяет каждый из них

### Takeaway
Для нашей задачи лучше всего подходит «мягкий стилизованный PBR / soft toon» в духе Supercell и Fall Guys: крупные простые формы, простой альбедо с парой оттенков, высокая шероховатость, яркая «конфетная» палитра, читаемый силуэт. В WebGL это дёшево, если свет запечён или сделан через градиент или matcap. Обводки и тяжёлый cel-shading стоят дороже и капризны в Babylon, поэтому их лучше включать только на ПК или делать дешёвым способом.

### Cited Findings
**Supercell (Clash of Clans, Clash Royale, Brawl Stars, Squad Busters):**
- Supercell Helsinki работает в PBR-пайплайне (Substance Painter, Maya, Arnold), но сознательно «ломает PBR во многих местах». Альбедо держат простым, с парой цветовых вариаций. Материалы, даже металлы, делают шероховатее, чем в реальности, ради красивого цветового градиента. Шероховатость у них главный инструмент стилизации. Пропсы и здания «скорее кубичные». Взгляд зрителя ведут лёгкими сдвигами цвета, тона и градиента, обычно к лицу персонажа — [Adobe Substance 3D Magazine, Supercell Helsinki](https://www.adobe.com/products/substance3d/magazine/supercell-helsinki-creating-stylized-content-for-clash-of-clans-and-clash-royale.html)
- Оговорка: в статье речь о рендерах (Arnold), а не о внутриигровых шейдерах. Запечённый свет на игровых персонажах Clash Royale источниками не подтверждён. На Polycount есть только непроверенное мнение, что игровые пропсы выглядят как «чистый diffuse с запечёнными vertex-lightmap» — [Polycount](https://polycount.com/discussion/comment/1308329)
- Каждый новый бравлер в Brawl Stars должен почти мгновенно передавать роль, силуэт, характер и игровую функцию (превью доклада GDC «Making of a Brawler») — [gamedev.net](https://gamedev.net/news/4113/); [GDC news](https://gdconf.com/news/go-inside-design-supercells-new-hit-game-brawl-stars-gdc-2019)
- Squad Busters сохраняет фирменную яркую палитру Supercell и единый с другими их играми стиль (вторичный, нетехнический источник) — [TapTap review](https://www.taptap.io/ru/post/8044647)
- Классическая рамка читаемости из доклада Valve по TF2: три уровня — цвет, силуэт, мелкая деталь — [Game Developer, Valve](https://www.gamedeveloper.com/art/in-depth-how-valve-makes-art-to-enhance-gameplay)

**Fall Guys (Mediatonic), «мягкий тун» и надувной пластик:**
- Бобы задуманы «неспортивными, но амбициозными»: короткие толстые ножки и большие руки, чтобы падения выглядели комично и «упруго». Референс — фигурки Kidrobot Yetiguy. Окружение должно выглядеть надувным, «из матов и резиновых молотков», с чистыми простыми цветами. Палитра «конфетная». Уровни намеренно держали визуально простыми, потому что на экране много персонажей — [GGRecon](https://www.ggrecon.com/articles/fall-guys-developers-reveal-what-makes-their-jelly-beans-so-lovable); [PCGamesInsider](https://www.pcgamesinsider.biz/feature/69833/how-mediatonic-made-the-takeshis-castle-of-video-games-in-fall-guys/)
- Техническую схему освещения Fall Guys найти не удалось (см. Gaps).

**Toon / cel-shading и обводки:**
- Основа стилизованного «иллюстративного» освещения (gradient Lambert, wrapped falloff, rim light) идёт от Team Fortress 2. Мобильный тулкит MobFort (UE5) делает градиенты через атлас палитр на персонажа, рисует силуэт rim-светом вместо обводки, смещает rim к верху тела и расширяет его, когда персонаж мелкий на экране — [MobFort GitHub](https://github.com/Vaei/MobFort)
- В Babylon есть официальный CellMaterial (демо cell shading) — [Babylon.js Cell Shading demo](https://www.babylonjs.com/Demos/CellShading/source/)
- Есть порт MToon (Unity/VRM) для Babylon: shade, rim, MatCap, ширина обводки по красному каналу текстуры. Часть настроек может игнорироваться или давать нестабильный свет — [babylon-mtoon-material](https://github.com/noppefoxwolf/babylon-mtoon-material)
- Встроенная обводка `mesh.renderOutline` ведёт себя по-разному на гладком и плоском шейдинге и плохо подходит для толстых линий, поэтому пользователи пишут свою — [Babylon forum, outline](https://forum.babylonjs.com/t/create-outline-around-a-3d-object/13805)
- Обводка постпроцессом в 2016 году давала 2 FPS на старом iPad, после переписывания 28 FPS. Постпроцесс к тому же теряет аппаратный антиалиасинг (данные устаревшие) — [html5gamedevs](https://www.html5gamedevs.com/topic/22520-outline-postprocess-as-overlay/)

**Low-poly и hand-painted:**
- Low-poly определяется как 3D-арт с низким числом полигонов на модель — [itch.io tag](https://itch.io/games/newest/platform-mobile-web/tag-low-poly?page=2)
- В Shadowgun (кейс Unity для мобильных) контраст и детали запечены в diffuse-текстуры, вместо реальных теней использованы blob-тени и лайтмапы, персонажи освещены light probes, а не реальными источниками — [Unity Manual, mobile optimization](https://docs.unity3d.com/ru/2018.3/Manual/MobileOptimizationGraphicsMethods.html)
- Есть дипломная работа о пайплайне low-poly плюс hand-painted — [Theseus.fi](https://www.theseus.fi/handle/10024/156811)

### Inferences
- **Краткая характеристика стилей** (синтез; где нет ссылки — **[эмпирическое правило]**):
  - *Supercell-stylized*: преувеличенные пропорции (крупные голова и кисти), кубичные пропсы, простой альбедо с 2–3 оттенками, высокая roughness, мягкий градиент, акцент на лице, очень чёткий силуэт. Обводок нет, читаемость держится на силуэте и цвете.
  - *Fall Guys / Stumble Guys soft toon*: округлые «надувные» формы, гладкие поверхности без мелкой детали, насыщенная конфетная палитра, мягкий свет, почти нет текстурной детали. Это самый дешёвый в рендере стиль: почти всё решают цвет и форма.
  - *Hand-painted*: свет и AO нарисованы в текстуре (как в Shadowgun или WoW-подобном стиле). Рендер дешёвый (unlit или почти unlit), но нужен художник. Meshy даёт PBR-текстуры, а не рисованные, так что для нашей команды это рискованно.
  - *Low-poly flat shaded*: фасетки, цвет по вершинам или по маленькой палитровой текстуре. Самый дешёвый и генерации не требует, но легко выглядит «дёшево», если нет хорошего света, тумана и цвета.
  - *Toon / cel с обводкой*: ступенчатый ramp и контур. Выглядит стильно, но обводка удваивает draw calls (inverted hull) или требует постпроцесса, и в Babylon есть известные проблемы с качеством.
  - *Clay / soft plastic*: matcap или PBR с высокой roughness, мягкий rim, ощущение «игрушки». Очень дёшево через matcap и хорошо сочетается с Meshy-моделями, где детали текстуры неидеальны.
- Для нашей игры (два персонажа, островки из плиток, небо) наиболее реалистична смесь Fall Guys и Supercell: округлые персонажи с простым альбедо, плитки с вершинным градиентом или маленьким палитровым атласом, rim-свет вместо обводки и мягкий туман по высоте на облаках.
- Meshy-модели часто дают шумную PBR-текстуру. Упрощение альбедо до 2–3 оттенков (повторная покраска или постеризация) и высокая roughness — путь, близкий к правилу Supercell «простой альбедо, шероховатость стилизует».

### Gaps
- Доклад GDC «Making of a Brawler» и другие доклады Supercell или Mediatonic по шейдерам: содержимое недоступно (GDC Vault).
- Как устроен внутриигровой шейдер и свет у Brawl Stars, Squad Busters и Fall Guys, публично не найдено. Нет и разбора Stumble Guys.
- Статьи 80.lv про стиль Squad Busters или Brawl Stars не найдены.

## 2. Какие техники рендера дают больше всего воспринимаемого качества на единицу стоимости GPU на мобильном WebGL

### Takeaway
Самые выгодные техники: запечённый свет и AO (в текстуры или в цвет вершин), градиентный или matcap-шейдинг, rim-свет, blob-тени вместо карт теней, туман, а также пониженное разрешение рендера с адаптацией (hardware scaling). Дороже всего на мобильных: постпроцессы (bloom, SSAO), динамические тени, альфа-блендинг или overdraw и большое число draw calls или материалов.

### Cited Findings
- Babylon: избегать SSAO2 и запекать AO. Для статичного света рендерить тени один раз (`REFRESHRATE_RENDER_ONCE`). Для динамических теней брать меньшую карту, `filteringQuality = QUALITY_LOW` и меньше кастеров и приёмников. Избегать материалов с альфа-блендингом и не злоупотреблять отражениями. Избегать rendering pipeline без нужды. Сжатые текстуры KTX2, Basis или ASTC. Мешу с несколькими материалами нужен draw call на каждый материал, поэтому стоит запекать в одну текстуру на канал — [Babylon forum, Best Practices](https://forum.babylonjs.com/t/best-practices-for-optimizing-babylon-js-scenes-not-just-on-lower-end-devices/58688)
- Babylon: `engine.setHardwareScalingLevel()` снижает разрешение рендера — [Babylon forum, Best Practices](https://forum.babylonjs.com/t/best-practices-for-optimizing-babylon-js-scenes-not-just-on-lower-end-devices/58688). Гайд третьей стороны советует начинать с уровня 2 на средних телефонах (25 % пикселей), 1.5 или нативное разрешение на топовых, 3 и выше на слабых — [abratabia, Babylon mobile](https://www.abratabia.com/babylonjs/mobile-browser.php) (неофициальный источник)
- Babylon по умолчанию НЕ адаптируется к devicePixelRatio, в пользу производительности. Включается четвёртым аргументом конструктора Engine ценой скорости — [Babylon docs, Optimize your scene](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene)
- PlayCanvas: DPR увеличивает число закрашиваемых пикселей, его нужно подбирать в рантайме по мощности устройства. Постэффекты дороги по заливке. Каждый всенаправленный источник с тенью рендерит сцену 6 раз. Серые карты стоит паковать в альфа-канал. Блендинг минимизировать, backface culling держать включённым — [PlayCanvas Optimization Guidelines](https://developer.playcanvas.com/user-manual/optimization/guidelines/)
- Shadowgun: blob-тени и лайтмапы вместо реальных теней, light probes для персонажей, детали запечены в diffuse — [Unity Manual, mobile](https://docs.unity3d.com/ru/2018.3/Manual/MobileOptimizationGraphicsMethods.html)
- Запечённый свет нельзя менять в рантайме и он не даёт динамических теней. Для движущихся источников рекомендуют mixed lighting — [Android Developers, Lighting for mobile games](https://developer.android.com/games/optimize/lighting-for-mobile-games-with-unity?hl=nl)
- Цвет вершин для ramp: смешивание строк градиента через vertex paint позволяет варьировать ramp по зонам без лишних текстур — [MobFort](https://github.com/Vaei/MobFort). Есть аддоны Blender для запекания простого света и градиентов в цвет вершин — [Vertex Color Octopus](https://superhivemarket.com/products/vertex-color-octopus)
- Антиалиасинг. MSAA остаётся предпочтительным на мобильных при forward-рендеринге, а FXAA — единственный «дешёвый» вариант среди постпроцессных, но он размывает картинку — [Samsung GameDev](https://developer.samsung.com/gamedev/blog/en-us/2021/06/01/using-conservative-morphological-anti-aliasing-to-improve-game-visuals). Стоимость FXAA зависит от размера экрана, а не от сложности сцены — [Godot forums](https://godotforums.org/d/21008-antialiasing-smoothing-a-texture). FXAA назван «очень дешёвым, в том числе для мобильных» — [three.js forum](https://discourse.threejs.org/t/performance-of-different-antialiasing-techniques/56740)
- Babylon: в DefaultRenderingPipeline по умолчанию `samples = 1`, то есть MSAA фактически выключен, пока не поднять значение. Максимум на устройстве смотрят через `engine.getCaps().maxMSAASamples` — [Babylon forum, AA with/without pipeline](https://forum.babylonjs.com/t/understanding-how-bjs-deal-with-antialiasing-with-and-without-pipeline/7264); [Babylon forum, antialias no effect](https://forum.babylonjs.com/t/engines-antialias-option-has-no-effect/52721)
- Arm (Mali): смена render state очень дорогая. Нужно батчить примитивы в один draw call и сортировать непрозрачное спереди назад, чтобы Z-тест отбрасывал фрагменты до шейдера — [Arm, mobile graphics optimization guides](https://www.slideshare.net/OwenWu/mobile-graphics-optimization-guides); [Arm Mali best practices](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/arm-mali-best-practices)
- Сокращение draw calls с 283 до 116 у одного пользователя Babylon не подняло FPS на мобильном: узким местом был CPU (evaluateActiveMeshes, computeWorldMatrix). Сначала нужно понять, во что упираешься, в CPU или GPU — [Babylon forum, Render performance](https://forum.babylonjs.com/t/render-performance/28644/2)
- CPU-оптимизации Babylon: `freezeWorldMatrix`, `material.freeze()`, `freezeActiveMeshes`, `doNotSyncBoundingInfo` (ломает picking), `skipPointerMovePicking`, `scene.performancePriority = Intermediate/Aggressive`, `autoClear = false`, если фон закрывает весь кадр — [Babylon docs, Optimize your scene](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene)
- Для массовых частиц: Solid Particle System или GPU-частицы. Для повторяющихся мешей: thin instances — [Babylon forum, Best Practices](https://forum.babylonjs.com/t/best-practices-for-optimizing-babylon-js-scenes-not-just-on-lower-end-devices/58688)

### Inferences
- **Приоритет по соотношению «качество/цена» для нашей сцены [эмпирическое правило]:**
  1. Свет и AO запечены в цвет вершин или в текстуру для плиток и островов (они статичны, а разрушение — это просто скрытие или анимация плитки).
  2. Персонажи: unlit или почти unlit материал с matcap либо градиентным ramp плюс rim по Френелю. Дешёвый NodeMaterial или ShaderMaterial вместо PBR на слабых устройствах.
  3. Blob-тень (диск с мягкой альфой или квадрат-декаль) под персонажами и снарядами вместо ShadowGenerator на мобильных. Она ещё и улучшает читаемость положения в воздухе.
  4. Туман или градиент по высоте и дистанции к цвету неба: облака и низ островов «растворяются», появляется глубина почти бесплатно (`scene.fogMode`, считается в шейдере).
  5. Небо: один градиентный купол или фон плюс несколько облаков-биллбордов с альфа-тестом, а не блендингом. Прозрачных слоёв минимум, потому что overdraw на мобильных дорог.
  6. Альтернатива bloom: «запечённое» свечение (emissive-цвет плюс аддитивный спрайт-ореол на снарядах) вместо полноэкранного bloom.
  7. AA: на мобильных при hardware scaling больше 1 MSAA обычно не нужен или слишком дорог. Лучше нативный `antialias` WebGL-контекста на средних устройствах или FXAA на ПК, если включён pipeline.
- Обводку, если она нужна для стиля, лучше делать rim-светом в том же шейдере (как MobFort), чем inverted hull (+1 draw call на меш) или постпроцессом.
- Плитки 9x11 = 99 на остров, около 198 на сцену: их нужно рисовать через thin instances или instances одного меша с одним материалом, иначе только плитки выйдут за бюджет draw calls для слабых телефонов (см. раздел 4).

### Gaps
- Нет свежих бенчмарков matcap против toon против PBR в Babylon на мобильных.
- Нет измерений стоимости FXAA и MSAA в Babylon на конкретных Android-устройствах. Это нужно профилировать самим.

## 3. Примеры красивых 3D-браузерных игр и кейсы с цифрами

### Takeaway
Публичных постмортемов с цифрами производительности по браузерным 3D-хитам почти нет. Известные примеры (Smash Karts, Shell Shockers на Babylon) подтверждают коммерческий успех простого стилизованного 3D, но техническую сторону не раскрывают. Самые полезные «кейсы» — это требования площадок и данные Poki о влиянии размера загрузки.

### Cited Findings
- Smash Karts (Tall Team, Дублин, март 2020): лидер по удержанию среди автомобильных игр на Poki, 573 секунды средней сессии, 2,6 млн игр, Poki Score 9,6, шесть лет обновлений, Discord на 250 000+. Движок в найденных источниках не указан — [DigitalCitizen](https://www.digitalcitizen.life/tall-teams-smash-karts-reaches-573-second-average-playtime/); [dotgg.gg](https://dotgg.gg/tall-teams-smash-karts-success-continues-with-obby-roads-on-poki/)
- Shell Shockers — известный шутер на Babylon.js. Официального дев-блога о том, как он сделан, сообщество не видело — [Babylon forum, apes.io comparison](https://forum.babylonjs.com/t/performance-comparison-rust-built-apes-io-vs-babylonjs/43441). Сторонний юзерскрипт для shellshock.io включает SceneOptimizer и `performancePriority = aggressive` (это не позиция разработчиков) — [Greasy Fork](https://greasyfork.org/ja/scripts/520841-increase-fps/code)
- Есть постмортем-разбор проекта на Babylon на форуме — [Babylon forum, Post mortem](https://forum.babylonjs.com/t/post-mortem-analysis-of-a-babylon-project/25947) (содержимое не изучено подробно)
- У PlayCanvas есть шоурилы браузерных игр 2021 и 2022 годов — [PlayCanvas, Made with PlayCanvas](https://developer.playcanvas.com/user-manual/getting-started/made-with-playcanvas); [html5gamedevs, showcase 2021](https://www.html5gamedevs.com/topic/47785-playcanvas-showcase-2021-browser-games-and-experiences-made-with-playcanvas/)
- Poki (июнь 2026): «за каждый лишний мегабайт загрузки вы теряете пару процентов игроков». 68 % игроков Poki на устройствах с поддержкой WebGPU, но WebGPU — это улучшение, а не требование: WebGL нужен для старых Android. Unity-сборки грузят один большой wasm и все ассеты при старте, что снижает конверсию. PlayCanvas легко делает отложенную загрузку — [Poki blog, Building web browser games 2026](https://poki.com/blog/building-web-browser-games-2026)
- Poki: минимум 30 FPS (цель 60), файлы как можно меньше, работа на стандартных соединениях вроде 3G — [Poki SDK](https://sdk.poki.com/deals). Цифра «initial download меньше 8 МБ» встречается только у третьей стороны и официально не подтверждена — [Cinevva](https://app.cinevva.com/guides/publish-game-poki); у другого источника жёсткого лимита нет, но игроки уходят после 10 секунд загрузки — [Summer Engine](https://www.summerengine.com/make-great-games/publish-an-html5-game)
- CrazyGames: всего до 250 МБ, initial download до 50 МБ, для мобильной главной до 20 МБ (меряется до события `gameplayStart`), до 1500 файлов, до геймплея не больше 20 секунд, должна работать на Chromebook с 4 ГБ RAM. Для Unity на iOS и Android с малой памятью платформа ставит DPR = 1 — [CrazyGames Technical Requirements](https://docs.crazygames.com/requirements/technical/)

### Inferences
- То, что CrazyGames принудительно ставит DPR = 1 на iOS и слабых Android даже для Unity, подтверждает правильность стратегии «рендер в 1x CSS-пикселях на мобильных» для Babylon. По умолчанию Babylon так и делает.
- Бюджет загрузки для нас [эмпирическое правило]: держать стартовую загрузку до первого боя в районе 10–20 МБ (это мобильная главная CrazyGames), модели сжимать через Draco или meshopt, текстуры через KTX2.

### Gaps
- Не найдено ни одного публичного постмортема 3D-игры с Poki или CrazyGames с цифрами draw calls, треугольников и FPS.
- Движок Smash Karts по найденным источникам не подтверждён.
- Официальный лимит размера Poki (если он есть) не найден.

## 4. Рекомендуемые бюджеты для 60/30 FPS на средних Android в WebGL

### Takeaway
Самое надёжное ограничение — draw calls: около 100–200 на слабых мобильных (PlayCanvas). Треугольники вторичны: форумные отчёты говорят о 200K треугольников на кадр без проблем на некоторых Android. На персонажа Meshy рекомендует около 3–5K треугольников для мобильных. Кости: до ~30, текстуры персонажа 512–1024 со сжатием.

### Cited Findings
- Draw calls: 100–200 — грубая цель для слабых мобильных, топовые ПК тянут тысячи при 60 FPS — [PlayCanvas Optimization Guidelines](https://developer.playcanvas.com/user-manual/optimization/guidelines/)
- Около 3000 draw calls в веб-игре назвали «супер-неоптимизированным», а 200K треугольников на кадр рендерились на некоторых Android без проблем, когда GPU не упирался в другое (форум, анекдотично) — [PlayCanvas forum, triangle count & draw calls](https://forum.playcanvas.com/t/need-advice-about-triangle-count-draw-calls/28572)
- Треугольники персонажа по Meshy (их же источники противоречат друг другу): около 5K для мобильных и около 20K для ПК; 3K–5K для казуальных мобильных и 10K–20K для «AAA-мобильных»; 1–3K для мобильного героя; «мобильные меньше 10K». Пресеты Remesh: 3K, 10K, 30K, 100K или своё значение. Remesh делать только на финальном ассете, до UV, текстур и рига. Экспорт в GLB для веба — [Meshy docs, Remesh](https://docs.meshy.ai/en/webapp/guides/3d-model/remesh); [Meshy docs, Game Assets](https://docs.meshy.ai/ph/webapp/guides/use-cases/game-assets); [Meshy, low poly tutorial](https://www.meshy.ai/tutorials/make-low-poly-3d-models)
- Старая документация Unity: 300–1500 полигонов на меш для мобильных, меньше 30 костей, один skinned mesh renderer на персонажа (данные устаревшие) — [Unity 4.6 Manual, Modeling Optimized Characters](https://docs.unity3d.com/460/Documentation/Manual/ModelingOptimizedCharacters.html)
- Babylon: скелет Mixamo около 70 костей, урезанный около 30. Выбирать по тому, насколько близко подходит камера — [Babylon forum, Best Practices](https://forum.babylonjs.com/t/best-practices-for-optimizing-babylon-js-scenes-not-just-on-lower-end-devices/58688)
- Текстуры уменьшать ступенчато 4K → 2K → 1K → меньше, пока не станет заметна потеря качества. Сжатие KTX2, Basis или ASTC — [Babylon forum, Best Practices](https://forum.babylonjs.com/t/best-practices-for-optimizing-babylon-js-scenes-not-just-on-lower-end-devices/58688)
- Arm: точного бюджета треугольников на Mali нет. Важнее соотношение примитивов к фрагментам (средний размер треугольника) и число смен состояния — [Arm community, Mali GPU counter](https://community.arm.com/support-forums/f/graphics-gaming-and-vr-forum/6301/mali-gpu-counter/23639)
- Humanoid-риг в Unity потребляет на 30–50 % больше CPU, чем generic. Полигоны и вершины дороги на мобильных — [Unity, mobile optimization tips part 2](https://unity.com/how-to/mobile-game-optimization-tips-part-2); [part 1](https://unity.com/how-to/mobile-game-optimization-tips-part-1)

### Inferences
**Предлагаемые бюджеты для нашей сцены (все — [эмпирическое правило], проверять профилированием на 2–3 реальных Android среднего и низкого класса):**

| Элемент | Слабый или средний Android (цель 30–60 FPS) | ПК |
|---|---|---|
| Персонаж (каждый из двух) | 4–8K треугольников (камера близко к своему игроку, враг далеко; врагу можно LOD 2–3K) | 15–25K (тот же ассет, LOD0) |
| Кости | 25–40 (урезанный риг, а не 70 от Mixamo) | то же |
| Текстура персонажа | 1 материал, 1 атлас 1024 (на слабых 512), KTX2 | 2048 |
| Плитка | 50–300 треугольников, один меш с одним материалом, thin instances: ~198 плиток = 1–2 draw call | то же |
| Остров (низ, скалы) | 2–5K на остров, свет и AO запечены в цвет вершин | то же |
| Снаряды и VFX | SPS или GPU-частицы, аддитивные спрайты, суммарно меньше 10 draw calls | больше частиц |
| Небо и облака | купол плюс 5–15 облаков-биллбордов в 1–3 draw call | больше слоёв |
| Draw calls всего | меньше 50–80 (с запасом до потолка 100–200 PlayCanvas) | 200+ без проблем |
| Треугольников на кадр | меньше 100K | 300–500K |
| Материалы и шейдеры | меньше 10 уникальных (компиляция шейдеров дорогая) | то же |
| Динамический свет | 1 hemispheric плюс 1 directional без теней | плюс тени |
| Разрешение | hardwareScalingLevel ~1/DPR (то есть 1x CSS) или больше; адаптивно по FPS | DPR 1–2, AA |

- Наша сцена естественно маленькая (два персонажа, две «доски»), поэтому главный риск не геометрия, а: (а) отдельный меш и материал на каждую плитку, (б) PBR-материалы Meshy с 4 текстурами 2K на объект, (в) постпроцессы и прозрачные облака на весь экран.
- Meshy с «AI Texturing (PBR)» по умолчанию даёт PBR-наборы. Для мобильных стоит оставлять только base color (плюс, возможно, AO, запечённую в base color) и рендерить дешёвым материалом.

### Gaps
- Нет официального бюджета треугольников и костей для Babylon в WebGL на мобильных. Все числа в таблице выше — ориентиры, собранные из разных источников.
- Нет данных о стоимости скиннинга (CPU и GPU) в Babylon 9 на конкретных телефонах.

## 5. Как масштабироваться вверх на ПК без отдельных ассетов

### Takeaway
Единый набор ассетов плюс уровни качества: на ПК поднимать разрешение рендера (DPR, hardware scaling), включать MSAA или FXAA, настоящие тени (ShadowGenerator с PCF), bloom и более плотные частицы. На мобильных — blob-тени, туман, запечённый свет, unlit или matcap. Babylon сам умеет деградировать качество через SceneOptimizer или performancePriority.

### Cited Findings
- Babylon SceneOptimizer (в том числе режим HighDegradationAllowed) и `performancePriority` для автоматической деградации — [Greasy Fork script](https://greasyfork.org/ja/scripts/520841-increase-fps/code); [Babylon docs, Optimize your scene](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene)
- Адаптация к DPR — опция конструктора Engine. Hardware scaling меняется в рантайме — [Babylon docs, Optimize your scene](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene); [Babylon forum, Best Practices](https://forum.babylonjs.com/t/best-practices-for-optimizing-babylon-js-scenes-not-just-on-lower-end-devices/58688)
- PlayCanvas: DPR выставлять в рантайме по мощности устройства — [PlayCanvas Optimization Guidelines](https://developer.playcanvas.com/user-manual/optimization/guidelines/)
- `powerPreference: "high-performance"` при создании движка (с откатом на default), LOD (ручные или auto-LOD, `mesh.simplify`) — [Babylon forum, Best Practices](https://forum.babylonjs.com/t/best-practices-for-optimizing-babylon-js-scenes-not-just-on-lower-end-devices/58688)
- Тени на ПК: карта 4096 в примере форума. На слабых устройствах карта меньше и QUALITY_LOW, а статичный свет рендерится один раз — [Babylon forum, Best Practices](https://forum.babylonjs.com/t/best-practices-for-optimizing-babylon-js-scenes-not-just-on-lower-end-devices/58688)
- WebGPU у 68 % игроков Poki — прирост для ПК и новых телефонов, но WebGL нужен как основа — [Poki blog 2026](https://poki.com/blog/building-web-browser-games-2026). Для WebGPU в Babylon есть отдельная страница оптимизаций, в том числе snapshot rendering — [Babylon forum search summary](https://forum.babylonjs.com/t/best-practices-for-optimizing-babylon-js-scenes-not-just-on-lower-end-devices/58688)

### Inferences
**Предлагаемая лестница качества (один набор ассетов) [эмпирическое правило]:**
- **Low (слабые Android):** hardware scaling 1.5–2 относительно CSS, без AA, unlit/matcap/ramp-материал, blob-тени, туман, без постпроцессов, облака с альфа-тестом, LOD1 у врага, частицы ×0.5, 30 FPS-кап при перегреве.
- **Medium (средние телефоны):** 1x CSS-пикселей, нативный antialias контекста, ramp плюс rim, blob-тени, мягкий аддитивный glow на снарядах, частицы ×1.
- **High (ПК):** DPR до 2, MSAA 4x или FXAA, StandardMaterial/PBR с теми же текстурами (roughness высокая), ShadowGenerator 1024–2048 только для двух персонажей и снарядов (плитки — приёмники), лёгкий bloom через DefaultRenderingPipeline, тон-маппинг, больше облаков и частиц.
- **Переключение:** стартовый уровень по эвристике (мобильный UA, `maxTextureSize`, `hardwareConcurrency`, рендерер GPU через `WEBGL_debug_renderer_info`, если доступен), затем динамическая подстройка hardware scaling по скользящему среднему frame time. Это укладывается в уже существующую «мобильную политику качества» проекта.
- Ассеты одни, меняются только материалы и флаги: LOD0 персонажа (~8–15K) на ПК и автоматический `simplify` или Meshy-ремеш в 3K как LOD1 на мобильных — в пределах одного GLB.

### Gaps
- Нет найденных данных о том, как Babylon 9 (а не 5–7) меняет стоимость этих опций. Источники в основном относятся к 2016–2025 годам.
- Надёжная детекция класса устройства в браузере (без доступа к модели GPU в Safari) источниками не покрыта.
