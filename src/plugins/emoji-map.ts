/**
 * The built-in shortcode → glyph map: a curated set of the most-used gemoji
 * (GitHub) shortcode names, so `emoji()` works out of the box and the stored
 * `:rocket:` tokens mean the same thing on GitHub, Slack, and Discord.
 *
 * Deliberately curated, not exhaustive (the full gemoji set is ~1,800 entries
 * — dozens of kilobytes a chat composer shouldn't pay for by default). Hosts
 * that want more (or custom emoji) pass their own `map`, or spread this one:
 * `emoji({ map: { ...defaultEmojiMap, shipit: "🐿️" } })`.
 *
 * Keys follow the gemoji names exactly, including the common aliases
 * (`+1`/`thumbsup`, `tada`/`hooray`, `white_check_mark`/`heavy_check_mark`).
 */
export const defaultEmojiMap: Record<string, string> = {
  // Smileys
  smile: "😄", smiley: "😃", grin: "😁", grinning: "😀", laughing: "😆",
  joy: "😂", rofl: "🤣", sweat_smile: "😅", blush: "😊", innocent: "😇",
  slightly_smiling_face: "🙂", upside_down_face: "🙃", wink: "😉",
  relieved: "😌", heart_eyes: "😍", smiling_face_with_three_hearts: "🥰",
  star_struck: "🤩", kissing_heart: "😘", yum: "😋", stuck_out_tongue: "😛",
  stuck_out_tongue_winking_eye: "😜", zany_face: "🤪", face_with_raised_eyebrow: "🤨",
  neutral_face: "😐", expressionless: "😑", no_mouth: "😶", smirk: "😏",
  unamused: "😒", roll_eyes: "🙄", grimacing: "😬", thinking: "🤔",
  shushing_face: "🤫", face_with_hand_over_mouth: "🤭", hugs: "🤗",
  sunglasses: "😎", nerd_face: "🤓", monocle_face: "🧐", confused: "😕",
  worried: "😟", frowning_face: "☹️", open_mouth: "😮", astonished: "😲",
  flushed: "😳", pleading_face: "🥺", cry: "😢", sob: "😭", scream: "😱",
  fearful: "😨", cold_sweat: "😰", disappointed: "😞", weary: "😩",
  tired_face: "😫", yawning_face: "🥱", triumph: "😤", rage: "😡",
  angry: "😠", exploding_head: "🤯", dizzy_face: "😵", mask: "😷",
  sleeping: "😴", drooling_face: "🤤", partying_face: "🥳",
  smiling_imp: "😈", skull: "💀", clown_face: "🤡", ghost: "👻",
  alien: "👽", robot: "🤖", poop: "💩",

  // Gestures & people
  "+1": "👍", thumbsup: "👍", "-1": "👎", thumbsdown: "👎", ok_hand: "👌",
  wave: "👋", raised_hands: "🙌", clap: "👏", pray: "🙏", handshake: "🤝",
  muscle: "💪", point_up: "☝️", point_down: "👇", point_left: "👈",
  point_right: "👉", crossed_fingers: "🤞", v: "✌️", metal: "🤘",
  call_me_hand: "🤙", writing_hand: "✍️", eyes: "👀", eye: "👁️",
  brain: "🧠", ear: "👂", nose: "👃", facepalm: "🤦", shrug: "🤷",
  bow: "🙇", raising_hand: "🙋", man_technologist: "👨‍💻",
  woman_technologist: "👩‍💻", family: "👪", people_hugging: "🫂",

  // Hearts & symbols
  heart: "❤️", orange_heart: "🧡", yellow_heart: "💛", green_heart: "💚",
  blue_heart: "💙", purple_heart: "💜", black_heart: "🖤", white_heart: "🤍",
  broken_heart: "💔", two_hearts: "💕", sparkling_heart: "💖",
  heartpulse: "💗", cupid: "💘", gift_heart: "💝", 100: "💯",
  anger: "💢", boom: "💥", collision: "💥", dizzy: "💫", sweat_drops: "💦",
  dash: "💨", zzz: "💤", fire: "🔥", sparkles: "✨", star: "⭐",
  star2: "🌟", zap: "⚡", comet: "☄️", rainbow: "🌈",

  // Nature & weather
  sunny: "☀️", partly_sunny: "⛅", cloud: "☁️", rain_cloud: "🌧️",
  snowflake: "❄️", snowman: "⛄", umbrella: "☔", ocean: "🌊",
  crescent_moon: "🌙", full_moon: "🌕", earth_africa: "🌍",
  earth_americas: "🌎", earth_asia: "🌏", volcano: "🌋", mountain: "⛰️",
  seedling: "🌱", herb: "🌿", four_leaf_clover: "🍀", maple_leaf: "🍁",
  fallen_leaf: "🍂", cactus: "🌵", palm_tree: "🌴", evergreen_tree: "🌲",
  deciduous_tree: "🌳", bouquet: "💐", cherry_blossom: "🌸", rose: "🌹",
  sunflower: "🌻", tulip: "🌷", hibiscus: "🌺",

  // Animals
  dog: "🐶", cat: "🐱", mouse: "🐭", hamster: "🐹", rabbit: "🐰",
  fox_face: "🦊", bear: "🐻", panda_face: "🐼", koala: "🐨", tiger: "🐯",
  lion: "🦁", cow: "🐮", pig: "🐷", frog: "🐸", monkey_face: "🐵",
  see_no_evil: "🙈", hear_no_evil: "🙉", speak_no_evil: "🙊",
  chicken: "🐔", penguin: "🐧", bird: "🐦", baby_chick: "🐤", duck: "🦆",
  eagle: "🦅", owl: "🦉", bat: "🦇", wolf: "🐺", horse: "🐴",
  unicorn: "🦄", bee: "🐝", bug: "🐛", butterfly: "🦋", snail: "🐌",
  ant: "🐜", spider: "🕷️", turtle: "🐢", snake: "🐍", octopus: "🐙",
  squid: "🦑", shrimp: "🦐", crab: "🦀", whale: "🐳", dolphin: "🐬",
  fish: "🐟", shark: "🦈", crocodile: "🐊", elephant: "🐘", gorilla: "🦍",
  dodo: "🦤", "t-rex": "🦖", sauropod: "🦕",

  // Food & drink
  apple: "🍎", banana: "🍌", grapes: "🍇", strawberry: "🍓", watermelon: "🍉",
  lemon: "🍋", peach: "🍑", pineapple: "🍍", mango: "🥭", avocado: "🥑",
  broccoli: "🥦", corn: "🌽", hot_pepper: "🌶️", bread: "🍞", cheese: "🧀",
  egg: "🥚", bacon: "🥓", hamburger: "🍔", fries: "🍟", pizza: "🍕",
  hotdog: "🌭", taco: "🌮", burrito: "🌯", ramen: "🍜", sushi: "🍣",
  bento: "🍱", curry: "🍛", rice: "🍚", dumpling: "🥟", cookie: "🍪",
  doughnut: "🍩", cake: "🍰", birthday: "🎂", cupcake: "🧁",
  chocolate_bar: "🍫", candy: "🍬", lollipop: "🍭", icecream: "🍦",
  popcorn: "🍿", coffee: "☕", tea: "🍵", milk_glass: "🥛", beer: "🍺",
  beers: "🍻", clinking_glasses: "🥂", wine_glass: "🍷", tumbler_glass: "🥃",
  cocktail: "🍸", tropical_drink: "🍹", champagne: "🍾", cup_with_straw: "🥤",

  // Activities & objects
  soccer: "⚽", basketball: "🏀", football: "🏈", baseball: "⚾",
  tennis: "🎾", volleyball: "🏐", "8ball": "🎱", ping_pong: "🏓",
  trophy: "🏆", medal_sports: "🏅", "1st_place_medal": "🥇",
  "2nd_place_medal": "🥈", "3rd_place_medal": "🥉", dart: "🎯",
  video_game: "🎮", game_die: "🎲", jigsaw: "🧩", chess_pawn: "♟️",
  performing_arts: "🎭", art: "🎨", clapper: "🎬", microphone: "🎤",
  headphones: "🎧", musical_note: "🎵", notes: "🎶", guitar: "🎸",
  drum: "🥁", trumpet: "🎺", violin: "🎻", tada: "🎉", hooray: "🎉",
  confetti_ball: "🎊", balloon: "🎈", gift: "🎁", ribbon: "🎀",
  crystal_ball: "🔮", camera: "📷", video_camera: "📹", movie_camera: "🎥",

  // Travel & places
  rocket: "🚀", airplane: "✈️", helicopter: "🚁", car: "🚗", taxi: "🚕",
  bus: "🚌", truck: "🚚", tractor: "🚜", bike: "🚲", motorcycle: "🏍️",
  train: "🚆", metro: "🚇", ship: "🚢", sailboat: "⛵", anchor: "⚓",
  fuelpump: "⛽", traffic_light: "🚥", construction: "🚧", house: "🏠",
  office: "🏢", school: "🏫", hospital: "🏥", bank: "🏦", hotel: "🏨",
  church: "⛪", stadium: "🏟️", statue_of_liberty: "🗽", tokyo_tower: "🗼",
  tent: "⛺", desert_island: "🏝️", world_map: "🗺️", compass: "🧭",

  // Work & tech
  computer: "💻", desktop_computer: "🖥️", keyboard: "⌨️",
  computer_mouse: "🖱️", printer: "🖨️", iphone: "📱", telephone: "☎️",
  battery: "🔋", electric_plug: "🔌", bulb: "💡", flashlight: "🔦",
  tv: "📺", radio: "📻", satellite: "📡", floppy_disk: "💾", cd: "💿",
  film_strip: "🎞️", envelope: "✉️", email: "📧", inbox_tray: "📥",
  outbox_tray: "📤", package: "📦", mailbox: "📫", memo: "📝",
  pencil2: "✏️", pen: "🖊️", paintbrush: "🖌️", crayon: "🖍️",
  briefcase: "💼", file_folder: "📁", open_file_folder: "📂",
  calendar: "📆", date: "📅", chart_with_upwards_trend: "📈",
  chart_with_downwards_trend: "📉", bar_chart: "📊", clipboard: "📋",
  pushpin: "📌", round_pushpin: "📍", paperclip: "📎", straight_ruler: "📏",
  scissors: "✂️", card_index_dividers: "🗂️", newspaper: "📰",
  bookmark: "🔖", label: "🏷️", book: "📖", books: "📚", notebook: "📓",
  ledger: "📒", page_facing_up: "📄", bookmark_tabs: "📑",
  microscope: "🔬", telescope: "🔭", test_tube: "🧪", dna: "🧬",
  wrench: "🔧", hammer: "🔨", hammer_and_wrench: "🛠️", screwdriver: "🪛",
  nut_and_bolt: "🔩", gear: "⚙️", toolbox: "🧰", magnet: "🧲",
  broom: "🧹", soap: "🧼", key: "🔑", old_key: "🗝️", lock: "🔒",
  unlock: "🔓", closed_lock_with_key: "🔐", shield: "🛡️", link: "🔗",
  chains: "⛓️", syringe: "💉", pill: "💊", stethoscope: "🩺",
  bell: "🔔", no_bell: "🔕", mega: "📣", loudspeaker: "📢",
  hourglass: "⌛", hourglass_flowing_sand: "⏳", watch: "⌚",
  alarm_clock: "⏰", stopwatch: "⏱️", timer_clock: "⏲️", clock1: "🕐",
  mag: "🔍", mag_right: "🔎", moneybag: "💰", dollar: "💵",
  credit_card: "💳", money_with_wings: "💸", coin: "🪙", gem: "💎",
  scales: "⚖️", crown: "👑", tophat: "🎩", graduation_cap: "🎓",
  eyeglasses: "👓", dark_sunglasses: "🕶️", closed_umbrella: "🌂",
  handbag: "👜", shopping_cart: "🛒",

  // Flags & signs
  checkered_flag: "🏁", triangular_flag_on_post: "🚩", white_flag: "🏳️",
  rainbow_flag: "🏳️‍🌈", warning: "⚠️", no_entry: "⛔", no_entry_sign: "🚫",
  white_check_mark: "✅", heavy_check_mark: "✔️", ballot_box_with_check: "☑️",
  x: "❌", negative_squared_cross_mark: "❎", question: "❓",
  exclamation: "❗", bangbang: "‼️", interrobang: "⁉️", heavy_plus_sign: "➕",
  heavy_minus_sign: "➖", heavy_division_sign: "➗", curly_loop: "➰",
  loop: "➿", part_alternation_mark: "〽️", recycle: "♻️", trident: "🔱",
  beginner: "🔰", o: "⭕", red_circle: "🔴", orange_circle: "🟠",
  yellow_circle: "🟡", green_circle: "🟢", large_blue_circle: "🔵",
  purple_circle: "🟣", black_circle: "⚫", white_circle: "⚪",
  red_square: "🟥", green_square: "🟩", blue_square: "🟦",
  arrow_right: "➡️", arrow_left: "⬅️", arrow_up: "⬆️", arrow_down: "⬇️",
  arrows_counterclockwise: "🔄", repeat: "🔁", fast_forward: "⏩",
  rewind: "⏪", arrow_forward: "▶️", pause_button: "⏸️", stop_button: "⏹️",
  record_button: "⏺️", new: "🆕", free: "🆓", up: "🆙", cool: "🆒",
  ok: "🆗", sos: "🆘", top: "🔝", soon: "🔜", on: "🔛", end: "🔚",
  back: "🔙", information_source: "ℹ️", id: "🆔", copyright: "©️",
  registered: "®️", tm: "™️", hash: "#️⃣", zero: "0️⃣", one: "1️⃣",
  two: "2️⃣", three: "3️⃣", speech_balloon: "💬", thought_balloon: "💭",
  wavy_dash: "〰️", infinity: "♾️",
};
