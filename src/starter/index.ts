/**
 * 既定コンテンツ（サンプルの世界観・登場人物・物語）。計画 P3。
 *
 * **目的は「起動していきなり行き止まりにならないこと」。** 素材が空の初回起動で
 * ここの中身をライブラリへ入れ、開始状態のセッションを1本作って開く（`store.ts` の
 * `seedStarterContent`）。中身は `docs/カセット作成ガイド_AI用.md` の書式に合わせてあり、
 * カセット JSON をそのまま TypeScript の定数に置き換えたものと思ってよい。
 *
 * 規約:
 * - **ここは純データに徹する**（`store.ts` を import しない＝循環参照を作らない）。
 *   id は安定文字列で、セッション側の id 振り直しは `seedStarterContent` が行う
 * - 素材の id は固定（`STARTER_WORLD_ID`・`STARTER_CHARACTER_IDS`）。「サンプルを追加し直す」は
 *   同じ id へ上書きするので、増殖しない
 * - `createdAt`/`updatedAt` は 0（投入時に現在時刻を刻む）
 * - **全年齢・固有名詞はすべて架空**（実在の学校・地名・人物を指さない）
 */
import type { Character, Session, World } from '../types'

export const STARTER_WORLD_ID = 'w_starter_kirisaka'

export const STARTER_CHARACTER_IDS = {
  /** 中心人物（視点人物）。転入してきた1年生 */
  focus: 'c_starter_suzu',
  /** 部長。物語を動かす側 */
  captain: 'c_starter_chitose',
  /** 名簿にだけ居る2年生。序盤は不在 */
  ghost: 'c_starter_ren',
} as const

/**
 * 導入（開始時に一度だけそのまま掲載される本文）。Web 小説の素の形＝セリフは「」で1発話1行、
 * 話者は地の文で分かるように書く（行頭の `@タグ「…」` ラベルは構造化出力の撤去で廃止）。
 */
const OPENING = `　坂をのぼりきると、海が見えた。
　自転車を押す手のひらが汗ばんでいる。越してきて三週間、この坂にはまだ慣れない。
　見上げた校舎の屋上に、白いドームがひとつ載っている。天文台みたいだ、と思って足を止めたところで、そのドームの扉が内側から押し開いた。
「見学？　それとも迷子？」
　手すりの向こうから、風に流れる髪をおさえながら誰かが身を乗り出している。
「……えっと。見て、ました」
「うん。ずっと見てた。三日連続で」
　そう言って、その人は笑った。
「あと一人なんだ。それが今年の条件。——上がっておいでよ、鍵ならもう開いてる」`

const OPENING_TITLE = '五月、ドームの鍵'

const OPENING_SCENE_NOTE =
  '五月十三日の放課後。霧坂高校の屋上と、その上に載った古い観測ドームの前。居るのは七海すずと東雲千歳の二人だけ（真木蓮は不在）。'

const GENRE = '現代・学園／静かな青春'

const PREMISE =
  '海の見える坂の町にある県立高校。屋上の古い観測ドームを預かる天文部は、名簿の部員が二人しかおらず、今年度いっぱいで廃部になろうとしている。春に越してきたばかりの一年生が、その鍵を渡される五月から物語は始まる。'

const INITIAL_DIRECTIVE =
  '最初のシーンでは入部の返事をさせない。ドームの中へ上げて、古い望遠鏡と代々の観測ノートを見せるところまでを描く。天文部が何を失いかけているのかは説明せず、埃・軋み・手触り・匂いで伝えること。'

/** 開始時点で控えている予定（条件も id 参照も持たない。基準日のない相対表現は書かない） */
const INITIAL_PENDING = [
  { when: '五月の終わり', what: '部員名簿を提出する。三人に満たなければ天文部は廃部になる' },
  { when: '梅雨に入る前の、晴れた夜', what: '「最後にもう一度だけ」と約束した観測会をひらく' },
]

const START_NOW = '5月13日 放課後'

/** サンプルの世界観（現代日本・小さな坂の町の高校）。ロアは5件・関係性の次元は2つに絞ってある */
export function starterWorld(): World {
  return {
    id: STARTER_WORLD_ID,
    name: '霧坂高校 天文部',
    description:
      '現代の日本。海へ向かって坂が下りていく小さな町・霧坂（きりさか）にある県立高校が舞台。丘の上に建つ古い校舎の屋上には、いまはもう珍しくなった観測ドームが載っている。事件は起きない。放課後と夜の空と、人がひとつの場所をどう手放すかだけがある話。',
    entries: [
      {
        id: 'lo_starter_rule',
        keys: [],
        content:
          '天文部は名簿の部員が三人に満たないと、その年度で廃部になる。いまの名簿には三年生の部長と、ほとんど顔を出さない二年生の二人しか載っていない。締切は五月の終わり。',
        alwaysOn: true,
        enabled: true,
        order: 0,
      },
      {
        id: 'lo_starter_dome',
        keys: ['ドーム', '望遠鏡', '屋上'],
        content:
          '屋上の観測ドームは校舎と同じ年に建てられた。開閉スリットは手回しで、途中で一度必ず引っかかる。中央に据えられた白い反射望遠鏡は鏡筒の塗装が剥げ、接眼部だけが手の脂で黒く光っている。夏でもドームの中はひんやりしている。',
        alwaysOn: false,
        enabled: true,
        order: 1,
      },
      {
        id: 'lo_starter_notes',
        keys: ['観測ノート', 'ノート', '記録', '日誌'],
        content:
          'ドームの棚には歴代の観測ノートが年度ごとに並んでいる。日付・天候・見たもの・書いた人の名前だけが淡々と続き、ときどき本題と関係のない一行（「風が強い」「今日で最後」）が挟まっている。最後の一冊は途中で途切れている。',
        alwaysOn: false,
        enabled: true,
        order: 2,
      },
      {
        id: 'lo_starter_festival',
        keys: ['文化祭', '観測会', '公開'],
        content:
          '霧坂高校の文化祭は秋。天文部はかつて、その夜に校舎を開けて公開観測会をひらいていた。町の人が坂をのぼって列を作った年もあったが、ここ数年は開かれていない。',
        alwaysOn: false,
        enabled: true,
        order: 3,
      },
      {
        id: 'lo_starter_town',
        keys: ['霧坂', '町', '坂', '海', '港'],
        content:
          '霧坂は港から丘へ一本の坂が伸びるだけの町。名前のとおり、春と秋の明け方はよく霧が出て、坂の下半分が白く沈む。街灯が少ないぶん、丘の上からは冬でなくても星がよく見える。',
        alwaysOn: false,
        enabled: true,
        order: 4,
      },
    ],
    relationAspects: [
      {
        id: 'asp_starter_trust',
        name: '信頼',
        guidance:
          'この人物が相手の言葉のどこを信じ、どこを話半分に聞いているか。任せられるか、まだ自分で確かめたいか。',
      },
      {
        id: 'asp_starter_distance',
        name: '距離',
        guidance:
          '踏み込んでよいと思っている範囲。名前の呼び方、黙っていられる時間の長さ、相手の事情をどこまで聞いてよいと思っているか。',
      },
    ],
    calendarFormat: '◯月◯日／朝・昼・放課後・夜',
    startPreset: {
      genre: GENRE,
      premise: PREMISE,
      opening: OPENING,
      openingTitle: OPENING_TITLE,
      openingSceneNote: OPENING_SCENE_NOTE,
      initialDirective: INITIAL_DIRECTIVE,
      newCharacterPolicy: 'allow',
      authorNote: '',
      startNow: START_NOW,
      initialPending: INITIAL_PENDING,
    },
    createdAt: 0,
    updatedAt: 0,
  }
}

/**
 * サンプルの登場人物3人（先頭が中心人物）。
 * 素材は単体で再利用されるので、`persona`/`speechStyle`/`appearance` に他の登場人物の名前を書かない。
 */
export function starterCharacters(): Character[] {
  return [
    {
      id: STARTER_CHARACTER_IDS.focus,
      name: '七海すず',
      persona:
        '高校一年生。父の転勤で春に越してきたばかりで、まだ誰の名前も覚えきれていない。人見知りで自分から話しかけられないが、気になったものは黙って何日でも見つめている。前の学校で部活に入らないまま三年を終えたことを、少しだけ後悔している。決めるのは遅い。その代わり、一度決めたことは誰に言われなくても続ける。',
      speechStyle:
        '一人称は「わたし」。語尾を言い切らず「……かも」「……だと思う」と濁す癖がある。驚くと言葉が極端に短くなり、相槌だけになる。敬語とタメ口が混ざる。',
      appearance:
        '肩に届く黒髪を低い位置でひとつに結んでいる。制服のリボンはいつも少しだけ緩い。背は低め。荷物が多く、鞄の口がいつも閉まりきっていない。',
      exampleDialogues: `「……あの。ここ、入っても、いいんですか」
「星、詳しくないです。名前も、三つくらいしか」
「わたし、たぶん向いてないと思う。でも、見たいとは思った」
「触っていいって言われても……壊しそうで」
「帰り道、まだ覚えてないんです。坂を下りればいいのは、わかるんですけど」`,
      greeting: '「……えっと、七海すずです。今日から、よろしくお願いします」',
      developments: [],
      avatar: { color: '#5b8def' },
      imagePrompt: '1girl, japanese highschool student, black hair, low ponytail, sailor uniform, blue ribbon, small stature',
      tags: ['サンプル', '中心人物', '1年'],
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: STARTER_CHARACTER_IDS.captain,
      name: '東雲千歳',
      persona:
        '高校三年生。天文部の部長で、実質ひとりで部を回している。面倒見がよく、初対面の相手にも壁を作らない——ように見えるが、自分の事情はほとんど話さない。受験の年であることも、部を残すためにどれだけ頭を下げてきたかも言わない。終わるものを終わらせないための段取りだけは、異様に早い。',
      speechStyle:
        '一人称は「わたし」。ひと呼吸おいてから話し、間を怖がらない。冗談めかした言い方で本題を切り出す。相手が黙っても急かさず、代わりに手を動かす。「まあ、いいや」で会話を切り上げる癖がある。',
      appearance:
        '背が高く、長い髪を風のたびに片手でおさえている。制服の上に色の褪せた紺のカーディガンを羽織っている。指先に、金属を触り続けた人の小さな傷がいくつかある。',
      exampleDialogues: `「鍵ならもう開いてる。開けたのはわたしだけど」
「スリット、途中で一回引っかかるんだ。そこで力を入れると曲がる。抜くの、こう」
「星の名前は覚えなくていいよ。覚えるのは、どこから昇るかだけ」
「やらない理由なら、こっちで三つくらい用意しといたから。使いたくなったら言って」
「まあ、いいや。今日は晴れてるし」`,
      greeting: '「東雲千歳。部長っていうか、部員が二人しかいないから自動的にそうなっただけ」',
      developments: [],
      avatar: { color: '#4cc9a4' },
      imagePrompt: '1girl, japanese highschool student, long dark hair, tall, navy cardigan over uniform, calm expression',
      tags: ['サンプル', '3年', '部長'],
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: STARTER_CHARACTER_IDS.ghost,
      name: '真木蓮',
      persona:
        '高校二年生。名簿には載っているが、部室にはほとんど顔を出さない。中学のころは誰よりも熱心だった側で、いまも機材の面倒だけは誰にも言わずに見ている。期待されることが苦手で、続けられなかったものの話をされると黙る。皮肉屋に見えるのは、本気を見せた後に引き返せなくなるのが怖いから。',
      speechStyle:
        '一人称は「俺」。口数が少なく、質問には最短で答える。語尾を伸ばさない。肝心なことほど背を向けたまま言う。褒められると話題を変える。',
      appearance:
        '痩せ型で猫背。伸ばしっぱなしの髪を無造作に払う。制服の袖口がいつも少しだけ汚れていて、指には油の匂いが残っていることがある。',
      exampleDialogues: `「別に。通りかかっただけ」
「その鏡、素手で触るな。跡が残る」
「……直したのは俺じゃない。勝手にそう思っとけ」
「やめた奴のことは、やめた奴に聞けよ」
「見たけりゃ勝手に見ろ。曇ってたら諦めろ」`,
      greeting: '「……真木。名簿には居ることになってる」',
      developments: [],
      avatar: { color: '#ef6f6c' },
      imagePrompt: '1boy, japanese highschool student, messy dark hair, slouching, school uniform, hands in pockets',
      tags: ['サンプル', '2年'],
      createdAt: 0,
      updatedAt: 0,
    },
  ]
}

/**
 * サンプルの開始セッション（未プレイの状態）。
 * id は安定文字列のまま返す。**投入時に `seedStarterContent` が session／scene／pending の id を振り直す**
 * （何度でも追加し直せるように）。`model` も投入時に既定モデルを刻む。
 */
export function starterSessionSeed(): Session {
  return {
    id: 'sess_starter',
    title: 'サンプル: 霧坂高校 天文部',
    mode: 'story',
    model: '',
    reviewModel: '',
    choicesModel: '',
    characterIds: [
      STARTER_CHARACTER_IDS.focus,
      STARTER_CHARACTER_IDS.captain,
      STARTER_CHARACTER_IDS.ghost,
    ],
    worldId: STARTER_WORLD_ID,
    focusCharacterId: STARTER_CHARACTER_IDS.focus,
    authorNote: '',
    story: {
      premise: PREMISE,
      genre: GENRE,
      opening: OPENING,
      openingTitle: OPENING_TITLE,
      initialDirective: INITIAL_DIRECTIVE,
    },
    scenes: [
      {
        id: 'scene_starter_1',
        title: 'シーン 1',
        note: OPENING_SCENE_NOTE,
        summary: '',
        createdAt: 0,
      },
    ],
    currentSceneId: 'scene_starter_1',
    narrativeStyle: 'novel',
    newCharacterPolicy: 'allow',
    state: {
      relations: [],
      moods: [],
      now: START_NOW,
      place: '',
      presentIds: [],
      situation: '',
      pending: INITIAL_PENDING.map((p, i) => ({ id: `pd_starter_${i + 1}`, ...p, bornAt: 0 })),
      recentDone: [],
    },
    overlay: { lore: [], characterDevelopments: [] },
    messages: [],
    temperature: 0.9,
    maxTokens: 32768,
    createdAt: 0,
    updatedAt: 0,
  }
}
