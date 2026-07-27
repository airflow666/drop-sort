/**
 * Локализация: русский и английский.
 *
 * ── Почему словарь, а не строки по месту ──────────────────────────────────
 * Площадка требует определять язык интерфейса через `ysdk.environment.i18n.lang`
 * (§2.14), а не через `navigator.language`: игрок мог открыть игру из
 * англоязычной витрины в русском браузере, и прав здесь именно SDK.
 *
 * ── Русский — источник истины ─────────────────────────────────────────────
 * Тип ключей выводится из русского словаря, а английский обязан быть
 * `Record<Key, string>`. Забытый перевод — это ошибка компиляции, а не пустая
 * строка в интерфейсе на боевой площадке. Обратное направление (лишний ключ в
 * английском) тоже не пройдёт: `Record` не допускает неизвестных полей.
 *
 * ── Язык ставится один раз, до сборки интерфейса ──────────────────────────
 * Переключателя языка в игре нет и не планируется: язык приходит от площадки и
 * за сессию не меняется. Поэтому `t()` читает модульную переменную, а не тянет
 * контекст через все компоненты, и экраны не нуждаются в перерисовке.
 * Единственное требование — вызвать `setLanguage` до первого `t()`; это
 * делается в App.start сразу после инициализации платформы.
 */

export type Lang = 'ru' | 'en';

/**
 * Название игры. Латиница и кириллица — одно и то же слово: игрок, увидевший
 * обложку в одной локали и игру в другой, должен узнать её мгновенно.
 */
const BRAND = { ru: 'ВИТРИНКА', en: 'VITRINKA' } as const;

const RU = {
  // ─── Общее ──────────────────────────────────────────────────────────────
  'app.title': 'ВИТРИНКА — собери свою полку',
  'app.description':
    'ВИТРИНКА — сортируй коллекционные фигурки по витринам, открывай блайнд-боксы и собирай сезонные серии.',
  'app.bootFailed': 'Не удалось загрузить игру.',
  'app.bootRetry': 'Обновите страницу.',

  'common.menu': 'В меню',
  'common.restart': 'Заново',
  'common.cancel': 'Отмена',
  'common.resume': 'Продолжить',
  'common.player': 'Игрок',
  'common.you': 'Вы',
  'common.back': 'Назад',
  'common.sound': 'Звук',

  // ─── HUD ────────────────────────────────────────────────────────────────
  'hud.case': 'витрина',
  'hud.moves': 'ходов',
  'hud.movesOf': 'из ~{n}',
  'hud.points': 'очков',
  'hud.collected': 'собрано',
  'hud.seconds': 'секунд',
  'hud.blitz': 'блиц',
  'hud.daily': 'вызов',
  'hud.aria.menu': 'В меню',
  'hud.aria.hint': 'Подсказка',
  'hud.aria.undo': 'Отменить ход',
  'hud.aria.extraShelf': 'Добавить свободную витрину',
  'hud.aria.sound': 'Звук',
  'hud.aria.soundOn': 'Включить звук',
  'hud.aria.soundOff': 'Выключить звук',

  // ─── Меню ───────────────────────────────────────────────────────────────
  'menu.case': 'Витрина {n}',
  'menu.resumeRun': 'продолжить партию',
  'menu.endless': 'бесконечная лента',
  'menu.blitz': 'Блиц',
  'menu.blitzAttempts': '60 секунд · {n} {attempts}',
  'menu.blitzRefill': 'попытка через {clock}',
  'menu.daily': 'Вызов дня',
  'menu.dailyDone': 'пройден — можно улучшить',
  'menu.dailyNew': 'один уровень для всех',
  'menu.dailyMoves': '{n} {moves}',
  'menu.new': 'новый',
  'menu.collection': 'Витрина {owned}/{total}',
  'menu.shop': 'Магазин',
  'menu.leaders': 'Лидеры',
  'menu.howToPlay': 'Как играть',
  'menu.season': 'СЕЗОН {id} · {name} · {n} {days}',

  // ─── Коллекция ──────────────────────────────────────────────────────────
  'collection.title': 'Витрина',
  'collection.box': 'Блайнд-бокс',
  'collection.boxNote':
    'Случайная фигурка серии. Только за монеты, дубликаты или просмотр — никогда за деньги.',
  'collection.boxBuy': 'Открыть · {n} монет',
  'collection.boxAd': '▶ Открыть за просмотр',
  'collection.boxTrade': 'Обменять дубликаты · {have}/{need}',
  'collection.hint':
    'Нажмите на собранную фигурку — она выйдет на поле вместо стандартной. Каждый силуэт меняется отдельно.',
  'collection.current': 'сейчас',
  'collection.unknown': '???',
  'collection.inPlay': 'НА ПОЛЕ',
  'collection.tipInPlay': '{what}. Сейчас на поле',
  'collection.tipEquip': '{what}. Нажмите, чтобы выставить на поле',

  // ─── Лидеры ─────────────────────────────────────────────────────────────
  'leaders.title': 'Лидеры',
  'leaders.blitz': 'Блиц',
  'leaders.blitzNote': 'очки за неделю',
  'leaders.daily': 'Вызов дня',
  'leaders.dailyNote': 'меньше ходов — выше',
  'leaders.empty': 'Таблица пока пуста. Сыграйте — и займёте её первым.',

  // ─── Магазин ────────────────────────────────────────────────────────────
  'shop.title': 'Магазин',
  'shop.note':
    'Всё, что покупается за деньги, показано заранее. Случайные боксы — только за монеты и просмотр.',
  'shop.cases': 'ВИТРИНЫ',
  'shop.casesNote': 'только внешний вид',
  'shop.casesHint':
    'Скин меняет конструкцию витрины и форму интерфейса — на правила это не влияет.',
  'shop.equipped': 'надет',
  'shop.equip': 'Надеть',
  'shop.money': 'ЗА ДЕНЬГИ',
  'shop.moneyNote': 'без случайности',
  'shop.owned': 'куплено',
  'shop.passLeft': 'Действует, осталось {n} {days}',

  'product.hints10.title': '10 подсказок',
  'product.hints10.note': 'Подсказка показывает следующий ход. Без рекламы.',
  'product.weekPass.title': 'Недельный пропуск',
  'product.weekPass.note': '60 монет и подсказка каждый день, 7 дней подряд. Первый день сразу.',
  'product.skinChrome.title': 'Скин витрин «Хром»',
  'product.skinChrome.note':
    'Полированный металл: фаска с бликом по кромке. Только внешний вид.',

  // ─── Победа ─────────────────────────────────────────────────────────────
  'victory.title': 'Витрина закрыта',
  'victory.next': 'Следующая витрина',
  'victory.perfect': 'Идеально: {n} {moves}',
  'victory.withOptimum': '{n} {moves}, оптимум {best}',
  'victory.plain': '{n} {moves}',
  'victory.double': '▶ ×2 к монетам',
  'victory.collection': 'Витрина',

  // ─── Тупик ──────────────────────────────────────────────────────────────
  'deadlock.title': 'Ходов больше нет',
  'deadlock.canHelp': 'Все витрины заняты. Свободная витрина расшивает любой тупик.',
  'deadlock.noHelp': 'Все витрины заняты. Этот уровень решается — попробуйте другой порядок.',
  // Тупик, доказанный солвером: ходы на поле ещё есть, и говорить «ходов
  // больше нет» игроку, который их видит, значит спорить с экраном.
  'deadlock.provenTitle': 'Выиграть уже нельзя',
  'deadlock.provenCanHelp':
    'Ходы ещё есть, но ни один не ведёт к победе. Свободная витрина расшивает такой тупик.',
  'deadlock.provenNoHelp':
    'Ходы ещё есть, но ни один не ведёт к победе. Уровень решается — попробуйте другой порядок.',
  'deadlock.extraShelf': '▶ +1 свободная витрина',

  // ─── Итог блица ─────────────────────────────────────────────────────────
  'blitz.record': 'Новый рекорд!',
  'blitz.over': 'Забег окончен',
  'blitz.summary': '{n} {shelves} за 60 секунд',
  'blitz.personalBest': 'Личный рекорд',
  'blitz.best': 'Рекорд: {n}',
  'blitz.rank': '{n} место за неделю',
  'blitz.again': 'Ещё забег',
  'blitz.againAd': '▶ Ещё забег',
  'blitz.refill': 'Бесплатная попытка через {clock}',
  'blitz.share': 'Поделиться результатом',
  'blitz.leaders': 'Лидеры недели',
  'blitz.shareText': '{brand} · блиц: {score} очков за 60 секунд, {sets} витрин.',
  'blitz.shareRank': ' {rank} место за неделю.',
  'blitz.shareCall': ' Побей мой результат!',
  'blitz.noAttempts': 'Попытки закончились',
  'blitz.noAttemptsNote': 'Бесплатная попытка восстанавливается каждые 15 минут.',
  'blitz.watchAd': '▶ Смотреть ролик',

  // ─── Вызов дня ──────────────────────────────────────────────────────────
  'daily.title': 'Вызов дня пройден',
  'daily.record': 'Лучший результат за сегодня — ваш',
  'daily.movesCaps': 'ХОДОВ',
  'daily.yourBest': 'Ваш рекорд: {n}',
  'daily.leaders': 'Кто быстрее',

  // ─── Блайнд-бокс ────────────────────────────────────────────────────────
  'box.title': 'Блайнд-бокс',
  'box.duplicate': 'Уже есть — в обмен. Дубликатов: {n}',
  'box.toShelf': 'На витрину',

  // ─── Стрик ──────────────────────────────────────────────────────────────
  'streak.title': 'Вы вернулись',
  'streak.note': 'День {n} подряд. Награда растёт до седьмого дня.',
  'streak.day': 'дн. {n}',
  'streak.claim': 'Забрать',

  // ─── Сезон ──────────────────────────────────────────────────────────────
  'season.title': 'Сезон {n}',
  'season.daysLeft': '{n} {days} до конца сезона',
  'season.collect': 'Собирать',

  // ─── Пауза и подтверждения ──────────────────────────────────────────────
  'pause.title': 'Пауза',
  'pause.restart': 'Начать заново',
  'resume.title': 'Продолжить партию?',
  'resume.note': 'Незаконченная витрина сохранилась с прошлого раза.',
  'resume.keep': 'Продолжить',
  'resume.fresh': 'Начать заново',
  // Диалог по кнопке «Назад» на пульте телевизора: платформа требует спросить
  // подтверждение, а не закрывать игру молча.
  'exit.title': 'Выйти из игры?',
  'exit.text': 'Прогресс сохранён — вернётесь на том же месте.',
  'exit.confirm': 'Выйти',

  // ─── Гайд ───────────────────────────────────────────────────────────────
  'tutorial.step1.title': 'Берём фигурку',
  'tutorial.step1.text': 'Тап по витрине поднимает верхнюю фигурку. Тап по ней же — кладёт обратно.',
  'tutorial.step2.title': 'Ставим к своим',
  'tutorial.step2.text':
    'Второй тап переносит её в пустую витрину или на такую же фигурку. По одной за раз.',
  'tutorial.step3.title': 'Витрина закрывается',
  'tutorial.step3.text':
    'Когда витрина заполнена одним видом целиком, её запирает стекло. Это готовый сет.',
  'tutorial.step4.title': 'Цель',
  'tutorial.step4.text': 'Закрыть все витрины. Чем меньше ходов — тем больше звёзд и монет.',
  'tutorial.step5.title': 'Бывает тупик',
  'tutorial.step5.text':
    'Неудачным порядком ходов можно зайти туда, откуда до победы уже не дойти. Тогда игра сама предложит начать заново — это не баг, а часть игры.',
  'tutorial.next': 'Дальше',
  'tutorial.skip': 'Пропустить',
  'tutorial.play': 'Играть',

  // ─── Сообщения ──────────────────────────────────────────────────────────
  'toast.alreadyInPlay': 'Уже на поле',
  'toast.asInSeries': '{name}: как в серии',
  'toast.nowInPlay': '{name} — на поле',
  'toast.noCoins': 'Не хватает монет',
  'toast.noDuplicates': 'Мало дубликатов',
  'toast.adNotCounted': 'Ролик не засчитан',
  'toast.seasonComplete': 'Серия собрана целиком! +500',
  'toast.purchaseFailed': 'Покупка не завершена',
  'toast.hintsAdded': '+10 подсказок',
  'toast.passDay': 'Пропуск: +{coins} и +{hints} подсказка. Осталось дней: {days}',
  'toast.skinApplied': 'Скин применён',
  'toast.idleHint': 'Застряли? Подсказка покажет ход',
  'toast.noHints': 'Подсказки закончились',
  'toast.noMoves': 'Ходов не осталось',
  'toast.alreadySolved': 'Уже собрано',
  'toast.copied': 'Результат скопирован',
  'toast.copyFailed': 'Не удалось скопировать',

  // ─── Реклама ────────────────────────────────────────────────────────────
  'ads.countdown': 'Реклама через',

  // ─── Редкость и отделка ─────────────────────────────────────────────────
  'rarity.common': 'обычная',
  'rarity.rare': 'редкая',
  'rarity.legendary': 'легендарная',
  'finish.holo': 'холо',
  'finish.glitter': 'блёстки',
  'finish.clear': 'прозрачная',
  'finish.gold': 'металлик',

  // ─── Сезоны ─────────────────────────────────────────────────────────────
  'season.1.name': 'НЕОН',
  'season.1.tagline': 'Аркада: робот, кассета, молния, кристалл',
  'season.2.name': 'ПЛЮШ',
  'season.2.tagline': 'Мягкая линейка: зверята из ткани',
  'season.3.name': 'ХРОМ',
  'season.3.tagline': 'Механика: железо с характером',
  'season.4.name': 'ЛЕТО',
  'season.4.tagline': 'Фрукты и пляж, мокрый глянец',
  'season.5.name': 'КОСМОС',
  'season.5.tagline': 'Планеты, кометы и спутники',
  'season.6.name': 'ДЕСЕРТ',
  'season.6.tagline': 'Финальный дроп: глазурь и посыпка',

  // ─── Скины витрин ───────────────────────────────────────────────────────
  'skin.season.name': 'Сезонное',
  'skin.season.note': 'Стеклянный неоновый шкаф. Меняет цвет вместе с серией.',
  'skin.wood.name': 'Ретро-полка',
  'skin.wood.note': 'Тёплое дерево, деревянная планка под каждым ярусом, мягкие углы.',
  'skin.brass.name': 'Латунь',
  'skin.brass.note': 'Литая рама на заклёпках, гравированный шильдик, янтарный свет.',
  'skin.arcade.name': 'Аркада',
  'skin.arcade.note': 'Игровой автомат: маркиза с лампами, боковые неонки, прямые углы.',
  'skin.crystal.name': 'Кристалл',
  'skin.crystal.note': 'Срезанные углы, ледяные грани и холодная преломлённая подсветка.',
  'skin.chrome.name': 'Хром',
  'skin.chrome.note': 'Полированный металл: фаска с бликом по кромке, холодное стекло.',

  // ─── Силуэты фигурок ────────────────────────────────────────────────────
  'shape.bot': 'Робот',
  'shape.tape': 'Кассета',
  'shape.bolt': 'Молния',
  'shape.heart': 'Сердце',
  'shape.disc': 'Диско',
  'shape.rocket': 'Ракета',
  'shape.glitch': 'Глитч',
  'shape.gem': 'Кристалл',
  'shape.bear': 'Мишка',
  'shape.bunny': 'Зайка',
  'shape.cat': 'Котик',
  'shape.duck': 'Утёнок',
  'shape.frog': 'Лягушка',
  'shape.sheep': 'Барашек',
  'shape.pig': 'Пятачок',
  'shape.owl': 'Совёнок',
  'shape.mech': 'Меха',
  'shape.cog': 'Шестерня',
  'shape.bulb': 'Лампа',
  'shape.capsule': 'Капсула',
  'shape.clock': 'Будильник',
  'shape.nut': 'Гайка',
  'shape.magnet': 'Магнит',
  'shape.battery': 'Батарейка',
  'shape.lemon': 'Лимон',
  'shape.melon': 'Арбуз',
  'shape.cherry': 'Вишня',
  'shape.pine': 'Ананас',
  'shape.berry': 'Клубника',
  'shape.cactus': 'Кактус',
  'shape.shell': 'Ракушка',
  'shape.pear': 'Груша',
  'shape.planet': 'Планета',
  'shape.moon': 'Луна',
  'shape.star': 'Звезда',
  'shape.comet': 'Комета',
  'shape.ufo': 'НЛО',
  'shape.sat': 'Спутник',
  'shape.nebula': 'Туманность',
  'shape.astro': 'Астронавт',
  'shape.donut': 'Пончик',
  'shape.cup': 'Кекс',
  'shape.pop': 'Эскимо',
  'shape.candy': 'Карамель',
  'shape.slice': 'Тортик',
  'shape.marsh': 'Зефир',
  'shape.lolli': 'Леденец',
  'shape.pudding': 'Пудинг',

  // ─── Названия чейзов ────────────────────────────────────────────────────
  'variant.acid': 'Кислотный',
  'variant.supernova': 'Супернова',
  'variant.whitenoise': 'Белый шум',
  'variant.goldendrop': 'Золотой дроп',
  'variant.marshmallow': 'Зефир',
  'variant.forgetmenot': 'Незабудка',
  'variant.matcha': 'Матча',
  'variant.dustyrose': 'Пыльная роза',
  'variant.titanium': 'Титан',
  'variant.mercury': 'Ртуть',
  'variant.brass': 'Латунь',
  'variant.platinum': 'Платина',
  'variant.lime': 'Лайм',
  'variant.mango': 'Манго',
  'variant.pomegranate': 'Гранат',
  'variant.lemonice': 'Лимонный лёд',
  'variant.aurora': 'Полярное',
  'variant.amethyst': 'Аметист',
  'variant.malachite': 'Малахит',
  'variant.nova': 'Сверхновая',
  'variant.bubblegum': 'Жвачка',
  'variant.mojito': 'Мохито',
  'variant.lavender': 'Лаванда',
  'variant.cottoncandy': 'Сахарная вата',
} as const;

export type Key = keyof typeof RU;

const EN: Record<Key, string> = {
  'app.title': 'VITRINKA — fill your shelf',
  'app.description':
    'VITRINKA — sort collectible figures into display cases, open blind boxes and complete seasonal series.',
  'app.bootFailed': 'The game failed to load.',
  'app.bootRetry': 'Please reload the page.',

  'common.menu': 'Menu',
  'common.restart': 'Restart',
  'common.cancel': 'Cancel',
  'common.resume': 'Resume',
  'common.player': 'Player',
  'common.you': 'You',
  'common.back': 'Back',
  'common.sound': 'Sound',

  'hud.case': 'case',
  'hud.moves': 'moves',
  'hud.movesOf': 'of ~{n}',
  'hud.points': 'points',
  'hud.collected': 'sorted',
  'hud.seconds': 'seconds',
  'hud.blitz': 'blitz',
  'hud.daily': 'daily',
  'hud.aria.menu': 'Back to menu',
  'hud.aria.hint': 'Hint',
  'hud.aria.undo': 'Undo the move',
  'hud.aria.extraShelf': 'Add an empty case',
  'hud.aria.sound': 'Sound',
  'hud.aria.soundOn': 'Turn sound on',
  'hud.aria.soundOff': 'Turn sound off',

  'menu.case': 'Case {n}',
  'menu.resumeRun': 'resume your game',
  'menu.endless': 'an endless run',
  'menu.blitz': 'Blitz',
  'menu.blitzAttempts': '60 seconds · {n} {attempts}',
  'menu.blitzRefill': 'next attempt in {clock}',
  'menu.daily': 'Daily challenge',
  'menu.dailyDone': 'solved — you can still improve',
  'menu.dailyNew': 'one level for everyone',
  'menu.dailyMoves': '{n} {moves}',
  'menu.new': 'new',
  'menu.collection': 'Collection {owned}/{total}',
  'menu.shop': 'Shop',
  'menu.leaders': 'Leaders',
  'menu.howToPlay': 'How to play',
  'menu.season': 'SEASON {id} · {name} · {n} {days}',

  'collection.title': 'Collection',
  'collection.box': 'Blind box',
  'collection.boxNote':
    'A random figure from the series. For coins, duplicates or a video only — never for money.',
  'collection.boxBuy': 'Open · {n} coins',
  'collection.boxAd': '▶ Open for a video',
  'collection.boxTrade': 'Trade duplicates · {have}/{need}',
  'collection.hint':
    'Tap a figure you own and it takes the field instead of the standard one. Each silhouette is swapped separately.',
  'collection.current': 'current',
  'collection.unknown': '???',
  'collection.inPlay': 'IN PLAY',
  'collection.tipInPlay': '{what}. In play right now',
  'collection.tipEquip': '{what}. Tap to put it in play',

  'leaders.title': 'Leaders',
  'leaders.blitz': 'Blitz',
  'leaders.blitzNote': 'points this week',
  'leaders.daily': 'Daily challenge',
  'leaders.dailyNote': 'fewer moves ranks higher',
  'leaders.empty': 'The table is still empty. Play a round and you will be the first on it.',

  'shop.title': 'Shop',
  'shop.note':
    'Everything sold for money is shown up front. Random boxes open for coins and videos only.',
  'shop.cases': 'CASES',
  'shop.casesNote': 'looks only',
  'shop.casesHint':
    'A skin changes how the case is built and how the interface is shaped — it never changes the rules.',
  'shop.equipped': 'equipped',
  'shop.equip': 'Equip',
  'shop.money': 'FOR MONEY',
  'shop.moneyNote': 'nothing random',
  'shop.owned': 'owned',
  'shop.passLeft': 'Active, {n} {days} left',

  'product.hints10.title': '10 hints',
  'product.hints10.note': 'A hint shows the next move. No video needed.',
  'product.weekPass.title': 'Weekly pass',
  'product.weekPass.note': '60 coins and a hint every day for 7 days. Day one lands right away.',
  'product.skinChrome.title': '“Chrome” case skin',
  'product.skinChrome.note':
    'Polished metal: a bevel catching light along the edge. Looks only.',

  'victory.title': 'Case closed',
  'victory.next': 'Next case',
  'victory.perfect': 'Perfect: {n} {moves}',
  'victory.withOptimum': '{n} {moves}, best possible {best}',
  'victory.plain': '{n} {moves}',
  'victory.double': '▶ ×2 coins',
  'victory.collection': 'Collection',

  'deadlock.title': 'No moves left',
  'deadlock.canHelp': 'Every case is taken. An empty case breaks any dead end.',
  'deadlock.noHelp': 'Every case is taken. This level is solvable — try another order.',
  'deadlock.provenTitle': 'No way to win left',
  'deadlock.provenCanHelp':
    'Moves are still there, but none of them wins. An empty case breaks such a dead end.',
  'deadlock.provenNoHelp':
    'Moves are still there, but none of them wins. The level is solvable — try another order.',
  'deadlock.extraShelf': '▶ +1 empty case',

  'blitz.record': 'New record!',
  'blitz.over': 'Run over',
  'blitz.summary': '{n} {shelves} in 60 seconds',
  'blitz.personalBest': 'Personal best',
  'blitz.best': 'Best: {n}',
  'blitz.rank': 'rank {n} this week',
  'blitz.again': 'Run again',
  'blitz.againAd': '▶ Run again',
  'blitz.refill': 'Free attempt in {clock}',
  'blitz.share': 'Share the result',
  'blitz.leaders': 'Leaders of the week',
  'blitz.shareText': '{brand} · blitz: {score} points in 60 seconds, {sets} cases.',
  'blitz.shareRank': ' Rank {rank} this week.',
  'blitz.shareCall': ' Beat my score!',
  'blitz.noAttempts': 'Out of attempts',
  'blitz.noAttemptsNote': 'A free attempt comes back every 15 minutes.',
  'blitz.watchAd': '▶ Watch a video',

  'daily.title': 'Daily challenge solved',
  'daily.record': 'Today’s best result is yours',
  'daily.movesCaps': 'MOVES',
  'daily.yourBest': 'Your best: {n}',
  'daily.leaders': 'Who is faster',

  'box.title': 'Blind box',
  'box.duplicate': 'Already owned — traded in. Duplicates: {n}',
  'box.toShelf': 'To the shelf',

  'streak.title': 'Welcome back',
  'streak.note': 'Day {n} in a row. The reward grows until the seventh day.',
  'streak.day': 'd {n}',
  'streak.claim': 'Claim',

  'season.title': 'Season {n}',
  'season.daysLeft': '{n} {days} left in the season',
  'season.collect': 'Start collecting',

  'pause.title': 'Paused',
  'pause.restart': 'Start over',
  'resume.title': 'Resume your game?',
  'resume.note': 'An unfinished case was saved from last time.',
  'resume.keep': 'Resume',
  'resume.fresh': 'Start over',
  'exit.title': 'Leave the game?',
  'exit.text': 'Your progress is saved — you will pick up right here.',
  'exit.confirm': 'Leave',

  'tutorial.step1.title': 'Pick a figure up',
  'tutorial.step1.text': 'A tap on a case lifts its top figure. Tap it again to put it back.',
  'tutorial.step2.title': 'Put it with its own kind',
  'tutorial.step2.text':
    'A second tap moves it into an empty case or onto a matching figure. One at a time.',
  'tutorial.step3.title': 'The case locks',
  'tutorial.step3.text':
    'Once a case is filled with a single kind, glass locks it shut. That is a finished set.',
  'tutorial.step4.title': 'The goal',
  'tutorial.step4.text': 'Close every case. The fewer moves, the more stars and coins.',
  'tutorial.step5.title': 'Dead ends happen',
  'tutorial.step5.text':
    'A bad order of moves can lock you in a spot with no way to win. The game will offer a restart right away — that is not a bug, just part of the puzzle.',
  'tutorial.next': 'Next',
  'tutorial.skip': 'Skip',
  'tutorial.play': 'Play',

  'toast.alreadyInPlay': 'Already in play',
  'toast.asInSeries': '{name}: back to the series default',
  'toast.nowInPlay': '{name} — in play',
  'toast.noCoins': 'Not enough coins',
  'toast.noDuplicates': 'Not enough duplicates',
  'toast.adNotCounted': 'The video was not counted',
  'toast.seasonComplete': 'Series completed! +500',
  'toast.purchaseFailed': 'The purchase was not completed',
  'toast.hintsAdded': '+10 hints',
  'toast.passDay': 'Pass: +{coins} and +{hints} hint. Days left: {days}',
  'toast.skinApplied': 'Skin applied',
  'toast.idleHint': 'Stuck? A hint will show you a move',
  'toast.noHints': 'No hints left',
  'toast.noMoves': 'No moves left',
  'toast.alreadySolved': 'Already solved',
  'toast.copied': 'Result copied',
  'toast.copyFailed': 'Could not copy',

  'ads.countdown': 'Ad in',

  'rarity.common': 'common',
  'rarity.rare': 'rare',
  'rarity.legendary': 'legendary',
  'finish.holo': 'holo',
  'finish.glitter': 'glitter',
  'finish.clear': 'clear',
  'finish.gold': 'metallic',

  'season.1.name': 'NEON',
  'season.1.tagline': 'Arcade: bot, tape, bolt, gem',
  'season.2.name': 'PLUSH',
  'season.2.tagline': 'The soft line: little fabric animals',
  'season.3.name': 'CHROME',
  'season.3.tagline': 'Mechanics: metal with a temper',
  'season.4.name': 'SUMMER',
  'season.4.tagline': 'Fruit and beach, wet gloss',
  'season.5.name': 'SPACE',
  'season.5.tagline': 'Planets, comets and satellites',
  'season.6.name': 'DESSERT',
  'season.6.tagline': 'The final drop: glaze and sprinkles',

  'skin.season.name': 'Seasonal',
  'skin.season.note': 'A glass neon cabinet. Changes colour together with the series.',
  'skin.wood.name': 'Retro shelf',
  'skin.wood.note': 'Warm wood, a plank under every tier, soft corners.',
  'skin.brass.name': 'Brass',
  'skin.brass.note': 'A cast riveted frame, an engraved plate, amber light.',
  'skin.arcade.name': 'Arcade',
  'skin.arcade.note': 'An arcade cabinet: a lit marquee, neon strips, square corners.',
  'skin.crystal.name': 'Crystal',
  'skin.crystal.note': 'Cut corners, icy facets and cold refracted light.',
  'skin.chrome.name': 'Chrome',
  'skin.chrome.note': 'Polished metal: a bevel catching light along the edge, cold glass.',

  'shape.bot': 'Bot',
  'shape.tape': 'Tape',
  'shape.bolt': 'Bolt',
  'shape.heart': 'Heart',
  'shape.disc': 'Disco',
  'shape.rocket': 'Rocket',
  'shape.glitch': 'Glitch',
  'shape.gem': 'Gem',
  'shape.bear': 'Teddy',
  'shape.bunny': 'Bunny',
  'shape.cat': 'Kitty',
  'shape.duck': 'Ducky',
  'shape.frog': 'Frog',
  'shape.sheep': 'Lamb',
  'shape.pig': 'Piggy',
  'shape.owl': 'Owlet',
  'shape.mech': 'Mech',
  'shape.cog': 'Cog',
  'shape.bulb': 'Bulb',
  'shape.capsule': 'Capsule',
  'shape.clock': 'Alarm',
  'shape.nut': 'Nut',
  'shape.magnet': 'Magnet',
  'shape.battery': 'Battery',
  'shape.lemon': 'Lemon',
  'shape.melon': 'Melon',
  'shape.cherry': 'Cherry',
  'shape.pine': 'Pineapple',
  'shape.berry': 'Berry',
  'shape.cactus': 'Cactus',
  'shape.shell': 'Shell',
  'shape.pear': 'Pear',
  'shape.planet': 'Planet',
  'shape.moon': 'Moon',
  'shape.star': 'Star',
  'shape.comet': 'Comet',
  'shape.ufo': 'UFO',
  'shape.sat': 'Satellite',
  'shape.nebula': 'Nebula',
  'shape.astro': 'Astro',
  'shape.donut': 'Donut',
  'shape.cup': 'Cupcake',
  'shape.pop': 'Ice pop',
  'shape.candy': 'Candy',
  'shape.slice': 'Cake',
  'shape.marsh': 'Marshmallow',
  'shape.lolli': 'Lolli',
  'shape.pudding': 'Pudding',

  'variant.acid': 'Acid',
  'variant.supernova': 'Supernova',
  'variant.whitenoise': 'White Noise',
  'variant.goldendrop': 'Golden Drop',
  'variant.marshmallow': 'Marshmallow',
  'variant.forgetmenot': 'Forget-Me-Not',
  'variant.matcha': 'Matcha',
  'variant.dustyrose': 'Dusty Rose',
  'variant.titanium': 'Titanium',
  'variant.mercury': 'Mercury',
  'variant.brass': 'Brass',
  'variant.platinum': 'Platinum',
  'variant.lime': 'Lime',
  'variant.mango': 'Mango',
  'variant.pomegranate': 'Pomegranate',
  'variant.lemonice': 'Lemon Ice',
  'variant.aurora': 'Aurora',
  'variant.amethyst': 'Amethyst',
  'variant.malachite': 'Malachite',
  'variant.nova': 'Nova',
  'variant.bubblegum': 'Bubblegum',
  'variant.mojito': 'Mojito',
  'variant.lavender': 'Lavender',
  'variant.cottoncandy': 'Cotton Candy',
};

/**
 * Формы множественного числа.
 *
 * Русскому нужно три формы и правило по последним двум цифрам, английскому —
 * две и сравнение с единицей. Держать их одной таблицей нельзя, поэтому у
 * каждого языка своя, а выбор формы делает `pluralize`.
 */
const RU_PLURALS = {
  moves: ['ход', 'хода', 'ходов'],
  days: ['день', 'дня', 'дней'],
  shelves: ['витрина', 'витрины', 'витрин'],
  attempts: ['попытка', 'попытки', 'попыток'],
} as const;

export type PluralKey = keyof typeof RU_PLURALS;

const EN_PLURALS: Record<PluralKey, readonly [string, string]> = {
  moves: ['move', 'moves'],
  days: ['day', 'days'],
  shelves: ['case', 'cases'],
  attempts: ['attempt', 'attempts'],
};

const DICTIONARIES: Record<Lang, Record<Key, string>> = { ru: RU, en: EN };

let current: Lang = 'ru';

/**
 * Нормализовать код языка от площадки.
 *
 * SDK возвращает коды вида `ru`, `en`, `en-US`, `tr`. Русский отдаём русским и
 * тем, у кого код языка не пришёл вовсе; всем остальным — английский. Это не
 * упрощение, а осознанный выбор запасного языка: игроку из турецкой витрины
 * английский текст понятнее русского.
 */
export function setLanguage(raw: string | null | undefined): Lang {
  const code = String(raw ?? '')
    .toLowerCase()
    .split(/[-_]/)[0];
  current = code === 'ru' ? 'ru' : code === '' ? 'ru' : 'en';
  // Атрибут lang нужен не для красоты: от него зависят переносы, подбор
  // системного шрифта и озвучка скринридером. Через globalThis, а не напрямую:
  // этот модуль импортируют и тесты, которые идут в Node без DOM.
  const doc = (globalThis as { document?: { documentElement: { lang: string } } }).document;
  if (doc) doc.documentElement.lang = current;
  return current;
}

export function lang(): Lang {
  return current;
}

/** Название игры в текущей локали. */
export function brand(): string {
  return BRAND[current];
}

/**
 * Строка по ключу с подстановкой `{name}`.
 *
 * Подстановки именованные, а не позиционные: в английском порядок слов часто
 * другой, и позиционные `%s` разъезжаются при первом же переводе.
 */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const template = DICTIONARIES[current][key] ?? RU[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  );
}

/** Форма слова под число: 1 ход, 2 хода, 5 ходов / 1 move, 2 moves. */
export function pluralize(n: number, key: PluralKey): string {
  if (current === 'en') {
    const [one, many] = EN_PLURALS[key];
    return Math.abs(n) === 1 ? one : many;
  }
  const forms = RU_PLURALS[key];
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/** Число с разделителями разрядов: 1 240 в русском, 1,240 в английском. */
export function formatNumber(value: number): string {
  const digits = Math.round(value).toString();
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, current === 'en' ? ',' : ' ');
}

/** Все ключи словаря — для теста полноты переводов. */
export function allKeys(): Key[] {
  return Object.keys(RU) as Key[];
}

/** Словарь целиком — только для теста; в игре читается через `t`. */
export function dictionary(language: Lang): Record<Key, string> {
  return DICTIONARIES[language];
}
