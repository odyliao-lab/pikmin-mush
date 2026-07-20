export type ScanRegion = {
  name: string;
  country: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
};

export type ScanTarget = {
  country: string;
  city: string;
  lat: number;
  lng: number;
  regionIndex: number;
  pointIndex: number;
  cooldownS: number;
};

export type ScanConfig = {
  mode: "auto" | "custom";
  countryPacks: string[];
  radiusKm: number;
  gridStepM: number;
  dwellS: number;
  hopDelayS: number;
  cooldownS: number;
  loop: boolean;
  custom?: {
    latMin: number;
    latMax: number;
    lngMin: number;
    lngMax: number;
  };
};

type Center = [name: string, lat: number, lng: number];

const JAPAN: Center[] = [
  ["札幌 Sapporo",43.0618,141.3545],["仙台 Sendai",38.2682,140.8694],
  ["東京 Tokyo",35.6812,139.7671],["橫濱 Yokohama",35.4437,139.6380],
  ["新潟 Niigata",37.9161,139.0364],["金澤 Kanazawa",36.5613,136.6562],
  ["靜岡 Shizuoka",34.9756,138.3828],["名古屋 Nagoya",35.1815,136.9066],
  ["京都 Kyoto",35.0116,135.7681],["大阪 Osaka",34.6937,135.5023],
  ["神戶 Kobe",34.6901,135.1955],["岡山 Okayama",34.6551,133.9195],
  ["廣島 Hiroshima",34.3853,132.4553],["高松 Takamatsu",34.3428,134.0466],
  ["福岡 Fukuoka",33.5902,130.4017],["熊本 Kumamoto",32.8031,130.7079],
  ["鹿兒島 Kagoshima",31.5966,130.5571],["那霸 Naha",26.2124,127.6809],
];

const AUSTRALIA: Center[] = [
  ["雪梨 Sydney",-33.8688,151.2093],["墨爾本 Melbourne",-37.8136,144.9631],
  ["布里斯本 Brisbane",-27.4698,153.0251],["伯斯 Perth",-31.9523,115.8613],
  ["阿德雷德 Adelaide",-34.9285,138.6007],["坎培拉 Canberra",-35.2809,149.1300],
  ["黃金海岸 Gold Coast",-28.0167,153.4000],["紐卡索 Newcastle",-32.9283,151.7817],
  ["荷巴特 Hobart",-42.8821,147.3272],["達爾文 Darwin",-12.4634,130.8456],
];

const NEW_ZEALAND: Center[] = [
  ["奧克蘭 Auckland",-36.8509,174.7645],["威靈頓 Wellington",-41.2866,174.7756],
  ["基督城 Christchurch",-43.5321,172.6362],["漢密爾頓 Hamilton",-37.7870,175.2793],
  ["陶朗加 Tauranga",-37.6878,176.1651],["但尼丁 Dunedin",-45.8788,170.5028],
  ["北帕默斯頓 Palmerston North",-40.3523,175.6082],["皇后鎮 Queenstown",-45.0312,168.6626],
];

const INDIA: Center[] = [
  ["新德里 New Delhi",28.6139,77.2090],["孟買 Mumbai",19.0760,72.8777],
  ["班加羅爾 Bengaluru",12.9716,77.5946],["欽奈 Chennai",13.0827,80.2707],
  ["加爾各答 Kolkata",22.5726,88.3639],["海得拉巴 Hyderabad",17.3850,78.4867],
  ["艾哈邁達巴德 Ahmedabad",23.0225,72.5714],["浦那 Pune",18.5204,73.8567],
  ["斋浦爾 Jaipur",26.9124,75.7873],["蘇拉特 Surat",21.1702,72.8311],
  ["勒克瑙 Lucknow",26.8467,80.9462],["科欽 Kochi",9.9312,76.2673],
];

const BRAZIL: Center[] = [
  ["聖保羅 Sao Paulo",-23.5505,-46.6333],["里約熱內盧 Rio de Janeiro",-22.9068,-43.1729],
  ["巴西利亞 Brasilia",-15.7939,-47.8828],["薩爾瓦多 Salvador",-12.9777,-38.5016],
  ["福塔雷薩 Fortaleza",-3.7319,-38.5267],["貝洛奧里藏特 Belo Horizonte",-19.9167,-43.9345],
  ["瑪瑙斯 Manaus",-3.1190,-60.0217],["庫里奇巴 Curitiba",-25.4284,-49.2733],
  ["累西腓 Recife",-8.0476,-34.8770],["阿雷格里港 Porto Alegre",-30.0346,-51.2177],
  ["貝倫 Belem",-1.4558,-48.4902],["戈亞尼亞 Goiania",-16.6869,-49.2648],
];

const ECUADOR: Center[] = [
  ["基多 Quito",-0.1807,-78.4678],["瓜亞基爾 Guayaquil",-2.1710,-79.9224],
  ["昆卡 Cuenca",-2.9001,-79.0059],["聖多明各 Santo Domingo",-0.2530,-79.1754],
  ["曼塔 Manta",-0.9677,-80.7089],["洛哈 Loja",-3.9931,-79.2042],
];

const ARGENTINA: Center[] = [
  ["布宜諾斯艾利斯 Buenos Aires",-34.6037,-58.3816],["科爾多瓦 Cordoba",-31.4201,-64.1888],
  ["羅薩里奧 Rosario",-32.9442,-60.6505],["門多薩 Mendoza",-32.8895,-68.8458],
  ["拉普拉塔 La Plata",-34.9215,-57.9545],["圖庫曼 Tucuman",-26.8083,-65.2176],
  ["馬德普拉塔 Mar del Plata",-38.0055,-57.5426],["薩爾塔 Salta",-24.7821,-65.4232],
  ["聖菲 Santa Fe",-31.6333,-60.7000],["內烏肯 Neuquen",-38.9516,-68.0591],
];

const SWEDEN: Center[] = [
  ["斯德哥爾摩 Stockholm",59.3293,18.0686],["哥德堡 Gothenburg",57.7089,11.9746],
  ["馬爾默 Malmo",55.6050,13.0038],["烏普薩拉 Uppsala",59.8586,17.6389],
  ["韋斯特羅斯 Vasteras",59.6099,16.5448],["厄勒布魯 Orebro",59.2753,15.2134],
];

const NORWAY: Center[] = [
  ["奧斯陸 Oslo",59.9139,10.7522],["卑爾根 Bergen",60.3913,5.3221],
  ["特隆赫姆 Trondheim",63.4305,10.3951],["斯塔萬格 Stavanger",58.9700,5.7331],
  ["特羅姆瑟 Tromso",69.6492,18.9553],["克里斯蒂安桑 Kristiansand",58.1467,7.9956],
];

const DENMARK: Center[] = [
  ["哥本哈根 Copenhagen",55.6761,12.5683],["奧胡斯 Aarhus",56.1629,10.2039],
  ["奧登斯 Odense",55.4038,10.4024],["奧爾堡 Aalborg",57.0488,9.9217],
  ["埃斯比約 Esbjerg",55.4765,8.4594],
];

const FINLAND: Center[] = [
  ["赫爾辛基 Helsinki",60.1699,24.9384],["埃斯波 Espoo",60.2055,24.6559],
  ["坦佩雷 Tampere",61.4978,23.7610],["圖爾庫 Turku",60.4518,22.2666],
  ["奧盧 Oulu",65.0121,25.4651],["于韋斯屈萊 Jyvaskyla",62.2426,25.7473],
];

const ICELAND: Center[] = [
  ["雷克雅維克 Reykjavik",64.1466,-21.9426],["科帕沃于爾 Kopavogur",64.1110,-21.9087],
  ["哈布納菲厄澤 Hafnarfjordur",64.0671,-21.9547],["阿克雷里 Akureyri",65.6885,-18.1262],
];

const UAE: Center[] = [
  ["杜拜 Dubai",25.2048,55.2708],["阿布達比 Abu Dhabi",24.4539,54.3773],
  ["沙迦 Sharjah",25.3463,55.4209],["艾因 Al Ain",24.1302,55.8023],
];

const SAUDI_ARABIA: Center[] = [
  ["利雅德 Riyadh",24.7136,46.6753],["吉達 Jeddah",21.4858,39.1925],
  ["麥加 Mecca",21.3891,39.8579],["麥地那 Medina",24.5247,39.5692],
  ["達曼 Dammam",26.4207,50.0888],
];

const ISRAEL: Center[] = [
  ["特拉維夫 Tel Aviv",32.0853,34.7818],["耶路撒冷 Jerusalem",31.7683,35.2137],
  ["海法 Haifa",32.7940,34.9896],["貝爾謝巴 Beer Sheva",31.2520,34.7915],
];

const JORDAN: Center[] = [
  ["安曼 Amman",31.9539,35.9106],["扎爾卡 Zarqa",32.0728,36.0880],
  ["伊爾比德 Irbid",32.5568,35.8469],["亞喀巴 Aqaba",29.5321,35.0063],
];

const QATAR: Center[] = [
  ["杜哈 Doha",25.2854,51.5310],["賴揚 Al Rayyan",25.2919,51.4244],
  ["沃克拉 Al Wakrah",25.1659,51.5976],
];

const GERMANY: Center[] = [
  ["柏林 Berlin",52.5200,13.4050],["漢堡 Hamburg",53.5511,9.9937],
  ["慕尼黑 Munich",48.1351,11.5820],["科隆 Cologne",50.9375,6.9603],
  ["法蘭克福 Frankfurt",50.1109,8.6821],["萊比錫 Leipzig",51.3397,12.3731],
];

const AUSTRIA: Center[] = [
  ["維也納 Vienna",48.2082,16.3738],["格拉茲 Graz",47.0707,15.4395],
  ["林茲 Linz",48.3069,14.2858],["薩爾斯堡 Salzburg",47.8095,13.0550],
  ["因斯布魯克 Innsbruck",47.2692,11.4041],
];

const SWITZERLAND: Center[] = [
  ["蘇黎世 Zurich",47.3769,8.5417],["日內瓦 Geneva",46.2044,6.1432],
  ["巴塞爾 Basel",47.5596,7.5886],["伯恩 Bern",46.9480,7.4474],
  ["洛桑 Lausanne",46.5197,6.6323],
];

const CZECHIA: Center[] = [
  ["布拉格 Prague",50.0755,14.4378],["布爾諾 Brno",49.1951,16.6068],
  ["俄斯特拉發 Ostrava",49.8209,18.2625],["比爾森 Plzen",49.7384,13.3736],
];

const POLAND: Center[] = [
  ["華沙 Warsaw",52.2297,21.0122],["克拉科夫 Krakow",50.0647,19.9450],
  ["羅茲 Lodz",51.7592,19.4560],["弗羅茨瓦夫 Wroclaw",51.1079,17.0385],
  ["波茲南 Poznan",52.4064,16.9252],["格但斯克 Gdansk",54.3520,18.6466],
];

const HUNGARY: Center[] = [
  ["布達佩斯 Budapest",47.4979,19.0402],["德布勒森 Debrecen",47.5316,21.6273],
  ["塞格德 Szeged",46.2530,20.1414],["米什科爾茨 Miskolc",48.1035,20.7784],
  ["佩奇 Pecs",46.0727,18.2323],
];

const ITALY: Center[] = [
  ["羅馬 Rome",41.9028,12.4964],["米蘭 Milan",45.4642,9.1900],
  ["拿坡里 Naples",40.8518,14.2681],["杜林 Turin",45.0703,7.6869],
  ["波隆那 Bologna",44.4949,11.3426],["佛羅倫斯 Florence",43.7696,11.2558],
  ["巴勒摩 Palermo",38.1157,13.3615],
];

const SPAIN: Center[] = [
  ["馬德里 Madrid",40.4168,-3.7038],["巴塞隆納 Barcelona",41.3874,2.1686],
  ["瓦倫西亞 Valencia",39.4699,-0.3763],["塞維亞 Seville",37.3891,-5.9845],
  ["薩拉戈薩 Zaragoza",41.6488,-0.8891],["馬拉加 Malaga",36.7213,-4.4214],
];

const PORTUGAL: Center[] = [
  ["里斯本 Lisbon",38.7223,-9.1393],["波多 Porto",41.1579,-8.6291],
  ["布拉加 Braga",41.5454,-8.4265],["科英布拉 Coimbra",40.2033,-8.4103],
  ["法魯 Faro",37.0194,-7.9304],
];

const GREECE: Center[] = [
  ["雅典 Athens",37.9838,23.7275],["塞薩洛尼基 Thessaloniki",40.6401,22.9444],
  ["帕特雷 Patras",38.2466,21.7346],["伊拉克利翁 Heraklion",35.3387,25.1442],
  ["拉里薩 Larissa",39.6390,22.4191],
];

const CROATIA: Center[] = [
  ["札格雷布 Zagreb",45.8150,15.9819],["斯普利特 Split",43.5081,16.4402],
  ["里耶卡 Rijeka",45.3271,14.4422],["奧西耶克 Osijek",45.5550,18.6955],
  ["杜布羅夫尼克 Dubrovnik",42.6507,18.0944],
];

const EGYPT: Center[] = [
  ["開羅 Cairo",30.0444,31.2357],["亞歷山卓 Alexandria",31.2001,29.9187],
  ["吉薩 Giza",30.0131,31.2089],["塞得港 Port Said",31.2653,32.3019],
  ["路克索 Luxor",25.6872,32.6396],["亞斯文 Aswan",24.0889,32.8998],
];

const MOROCCO: Center[] = [
  ["卡薩布蘭卡 Casablanca",33.5731,-7.5898],["拉巴特 Rabat",34.0209,-6.8416],
  ["馬拉喀什 Marrakech",31.6295,-7.9811],["非斯 Fes",34.0181,-5.0078],
  ["丹吉爾 Tangier",35.7595,-5.8340],["阿加迪爾 Agadir",30.4278,-9.5981],
];

const ALGERIA: Center[] = [
  ["阿爾及爾 Algiers",36.7538,3.0588],["奧蘭 Oran",35.6971,-0.6308],
  ["君士坦丁 Constantine",36.3650,6.6147],["安納巴 Annaba",36.9000,7.7667],
  ["塞提夫 Setif",36.1900,5.4100],
];

const TUNISIA: Center[] = [
  ["突尼斯 Tunis",36.8065,10.1815],["斯法克斯 Sfax",34.7406,10.7603],
  ["蘇塞 Sousse",35.8256,10.6369],["凱魯萬 Kairouan",35.6781,10.0963],
  ["比塞大 Bizerte",37.2744,9.8739],
];

const GUATEMALA: Center[] = [
  ["瓜地馬拉市 Guatemala City",14.6349,-90.5069],
  ["克薩爾特南戈 Quetzaltenango",14.8347,-91.5181],
  ["埃斯昆特拉 Escuintla",14.3050,-90.7850],["安地瓜 Antigua",14.5586,-90.7295],
];

const HONDURAS: Center[] = [
  ["德古西加巴 Tegucigalpa",14.0723,-87.1921],
  ["聖佩德羅蘇拉 San Pedro Sula",15.5007,-88.0330],
  ["拉塞瓦 La Ceiba",15.7703,-86.7919],["喬洛馬 Choloma",15.6144,-87.9530],
];

const EL_SALVADOR: Center[] = [
  ["聖薩爾瓦多 San Salvador",13.6929,-89.2182],["聖安娜 Santa Ana",13.9942,-89.5597],
  ["聖米格爾 San Miguel",13.4833,-88.1833],["聖塔特克拉 Santa Tecla",13.6769,-89.2797],
];

const NICARAGUA: Center[] = [
  ["馬拿瓜 Managua",12.1140,-86.2362],["雷昂 Leon",12.4379,-86.8780],
  ["格拉納達 Granada",11.9344,-85.9560],["馬薩亞 Masaya",11.9744,-86.0942],
];

const COSTA_RICA: Center[] = [
  ["聖荷西 San Jose",9.9281,-84.0907],["阿拉胡埃拉 Alajuela",10.0163,-84.2116],
  ["埃雷迪亞 Heredia",10.0024,-84.1165],["卡塔戈 Cartago",9.8644,-83.9194],
  ["利韋里亞 Liberia",10.6346,-85.4400],
];

const PANAMA: Center[] = [
  ["巴拿馬市 Panama City",8.9824,-79.5199],["科隆 Colon",9.3547,-79.9001],
  ["戴維 David",8.4273,-82.4309],["聖地牙哥 Santiago",8.1004,-80.9830],
  ["奇特雷 Chitre",7.9608,-80.4297],
];

const USA_EAST: Center[] = [
  ["紐約 New York",40.7128,-74.0060],["波士頓 Boston",42.3601,-71.0589],
  ["費城 Philadelphia",39.9526,-75.1652],["華盛頓 Washington DC",38.9072,-77.0369],
  ["巴爾的摩 Baltimore",39.2904,-76.6122],["邁阿密 Miami",25.7617,-80.1918],
  ["奧蘭多 Orlando",28.5383,-81.3792],["亞特蘭大 Atlanta",33.7490,-84.3880],
  ["夏洛特 Charlotte",35.2271,-80.8431],["洛利 Raleigh",35.7796,-78.6382],
  ["匹茲堡 Pittsburgh",40.4406,-79.9959],["水牛城 Buffalo",42.8864,-78.8784],
];

const USA_CENTRAL: Center[] = [
  ["芝加哥 Chicago",41.8781,-87.6298],["休士頓 Houston",29.7604,-95.3698],
  ["達拉斯 Dallas",32.7767,-96.7970],["奧斯汀 Austin",30.2672,-97.7431],
  ["聖安東尼奧 San Antonio",29.4241,-98.4936],["明尼亞波利斯 Minneapolis",44.9778,-93.2650],
  ["聖路易 St Louis",38.6270,-90.1994],["堪薩斯城 Kansas City",39.0997,-94.5786],
  ["丹佛 Denver",39.7392,-104.9903],["奧克拉荷馬市 Oklahoma City",35.4676,-97.5164],
  ["紐奧良 New Orleans",29.9511,-90.0715],["密爾瓦基 Milwaukee",43.0389,-87.9065],
];

const USA_WEST: Center[] = [
  ["洛杉磯 Los Angeles",34.0522,-118.2437],["舊金山 San Francisco",37.7749,-122.4194],
  ["聖地牙哥 San Diego",32.7157,-117.1611],["西雅圖 Seattle",47.6062,-122.3321],
  ["波特蘭 Portland",45.5152,-122.6784],["拉斯維加斯 Las Vegas",36.1699,-115.1398],
  ["鳳凰城 Phoenix",33.4484,-112.0740],["鹽湖城 Salt Lake City",40.7608,-111.8910],
  ["沙加緬度 Sacramento",38.5816,-121.4944],["聖荷西 San Jose",37.3382,-121.8863],
  ["檀香山 Honolulu",21.3099,-157.8581],["安克拉治 Anchorage",61.2181,-149.9003],
];

// 國家目錄是擴充的唯一入口。新增歐美國家時只需要加入一個定義，
// 排程器、後台選項與 Agent 區域偏好都會自動沿用。
export const COUNTRY_PACK_CATALOG = [
  { id: "jp", name: "日本", region: "亞洲", cities: JAPAN },
  { id: "in", name: "印度", region: "亞洲", cities: INDIA },
  { id: "au", name: "澳洲", region: "大洋洲", cities: AUSTRALIA },
  { id: "nz", name: "紐西蘭", region: "大洋洲", cities: NEW_ZEALAND },
  { id: "br", name: "巴西", region: "南美洲", cities: BRAZIL },
  { id: "ec", name: "厄瓜多", region: "南美洲", cities: ECUADOR },
  { id: "ar", name: "阿根廷", region: "南美洲", cities: ARGENTINA },
  { id: "se", name: "瑞典", region: "北歐", cities: SWEDEN },
  { id: "no", name: "挪威", region: "北歐", cities: NORWAY },
  { id: "dk", name: "丹麥", region: "北歐", cities: DENMARK },
  { id: "fi", name: "芬蘭", region: "北歐", cities: FINLAND },
  { id: "is", name: "冰島", region: "北歐", cities: ICELAND },
  { id: "ae", name: "阿拉伯聯合大公國", region: "中東", cities: UAE },
  { id: "sa", name: "沙烏地阿拉伯", region: "中東", cities: SAUDI_ARABIA },
  { id: "il", name: "以色列", region: "中東", cities: ISRAEL },
  { id: "jo", name: "約旦", region: "中東", cities: JORDAN },
  { id: "qa", name: "卡達", region: "中東", cities: QATAR },
  { id: "de", name: "德國", region: "中歐", cities: GERMANY },
  { id: "at", name: "奧地利", region: "中歐", cities: AUSTRIA },
  { id: "ch", name: "瑞士", region: "中歐", cities: SWITZERLAND },
  { id: "cz", name: "捷克", region: "中歐", cities: CZECHIA },
  { id: "pl", name: "波蘭", region: "中歐", cities: POLAND },
  { id: "hu", name: "匈牙利", region: "中歐", cities: HUNGARY },
  { id: "it", name: "義大利", region: "南歐", cities: ITALY },
  { id: "es", name: "西班牙", region: "南歐", cities: SPAIN },
  { id: "pt", name: "葡萄牙", region: "南歐", cities: PORTUGAL },
  { id: "gr", name: "希臘", region: "南歐", cities: GREECE },
  { id: "hr", name: "克羅埃西亞", region: "南歐", cities: CROATIA },
  { id: "eg", name: "埃及", region: "北非", cities: EGYPT },
  { id: "ma", name: "摩洛哥", region: "北非", cities: MOROCCO },
  { id: "dz", name: "阿爾及利亞", region: "北非", cities: ALGERIA },
  { id: "tn", name: "突尼西亞", region: "北非", cities: TUNISIA },
  { id: "gt", name: "瓜地馬拉", region: "中美洲", cities: GUATEMALA },
  { id: "hn", name: "宏都拉斯", region: "中美洲", cities: HONDURAS },
  { id: "sv", name: "薩爾瓦多", region: "中美洲", cities: EL_SALVADOR },
  { id: "ni", name: "尼加拉瓜", region: "中美洲", cities: NICARAGUA },
  { id: "cr", name: "哥斯大黎加", region: "中美洲", cities: COSTA_RICA },
  { id: "pa", name: "巴拿馬", region: "中美洲", cities: PANAMA },
  { id: "us-east", name: "美國東部", region: "北美洲", cities: USA_EAST },
  { id: "us-central", name: "美國中部", region: "北美洲", cities: USA_CENTRAL },
  { id: "us-west", name: "美國西部", region: "北美洲", cities: USA_WEST },
] as const;

export const COUNTRY_PACKS: Record<string, Center[]> = Object.fromEntries(
  COUNTRY_PACK_CATALOG.flatMap((pack) => [
    [pack.name, pack.cities],
    [pack.id, pack.cities],
  ]),
);

export const COUNTRY_PACK_LABELS = COUNTRY_PACK_CATALOG.map(
  ({ id, name, region, cities }) => ({ id, name, region, count: cities.length }),
);

function finite(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} 必須是數字`);
  return number;
}

function bounded(value: unknown, min: number, max: number, label: string) {
  const number = finite(value, label);
  if (number < min || number > max) {
    throw new Error(`${label} 必須介於 ${min} 到 ${max}`);
  }
  return number;
}

export function normalizeScanConfig(input: unknown): ScanConfig {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mode = body.mode === "custom" ? "custom" : "auto";
  const customBody = (body.custom && typeof body.custom === "object" ?
    body.custom : {}) as Record<string, unknown>;
  const config: ScanConfig = {
    mode,
    countryPacks: Array.isArray(body.countryPacks) ? body.countryPacks.map(String) : [],
    radiusKm: bounded(body.radiusKm ?? 2, 0.5, 10, "城市半徑"),
    gridStepM: bounded(body.gridStepM ?? 600, 100, 2000, "網格間距"),
    dwellS: bounded(body.dwellS ?? 8, 3, 120, "每點等待"),
    hopDelayS: bounded(body.hopDelayS ?? 2, 0, 60, "跳點延遲"),
    cooldownS: bounded(body.cooldownS ?? 45, 0, 300, "跨城市冷卻"),
    loop: body.loop !== false,
  };
  if (mode === "custom") {
    const latMin = bounded(customBody.latMin, -90, 90, "南界");
    const latMax = bounded(customBody.latMax, -90, 90, "北界");
    const lngMin = bounded(customBody.lngMin, -180, 180, "西界");
    const lngMax = bounded(customBody.lngMax, -180, 180, "東界");
    if (latMin > latMax || lngMin > lngMax) throw new Error("GPS 範圍上下界不正確");
    config.custom = { latMin, latMax, lngMin, lngMax };
  }
  return config;
}

function centerRegion(name: string, country: string, lat: number, lng: number, radiusKm: number) {
  const dlat = radiusKm / 111.32;
  const dlng = radiusKm / (111.32 * Math.max(0.2, Math.abs(Math.cos(lat * Math.PI / 180))));
  return { name, country, latMin: lat - dlat, latMax: lat + dlat,
    lngMin: lng - dlng, lngMax: lng + dlng };
}

function center(region: ScanRegion) {
  return {
    lat: (region.latMin + region.latMax) / 2,
    lng: (region.lngMin + region.lngMax) / 2,
  };
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radius = 6371;
  const dlat = (b.lat - a.lat) * Math.PI / 180;
  const dlng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dlng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function optimize(regions: ScanRegion[], start?: { lat: number; lng: number } | null) {
  const remaining = [...regions];
  const ordered: ScanRegion[] = [];
  let cursor = start ?? null;
  while (remaining.length) {
    let best = 0;
    if (cursor) {
      best = remaining.reduce((winner, region, index) =>
        distanceKm(cursor!, center(region)) < distanceKm(cursor!, center(remaining[winner]))
          ? index : winner, 0);
    }
    const [region] = remaining.splice(best, 1);
    ordered.push(region);
    cursor = center(region);
  }
  return ordered;
}

function grid(region: ScanRegion, stepM: number) {
  const latCenter = (region.latMin + region.latMax) / 2;
  const latStep = stepM / 111_320;
  const lngStep = stepM / (111_320 * Math.max(0.2, Math.abs(Math.cos(latCenter * Math.PI / 180))));
  const rows = Math.max(1, Math.floor((region.latMax - region.latMin) / latStep) + 1);
  const cols = Math.max(1, Math.floor((region.lngMax - region.lngMin) / lngStep) + 1);
  const points: Array<{ lat: number; lng: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    const lat = Math.min(region.latMax, region.latMin + row * latStep);
    const lngs = Array.from({ length: cols }, (_, column) =>
      Math.min(region.lngMax, region.lngMin + column * lngStep));
    if (row % 2) lngs.reverse();
    for (const lng of lngs) points.push({ lat, lng });
  }
  return points;
}

export function buildScanPlan(
  config: ScanConfig,
  currentLocation?: { lat: number; lng: number } | null,
) {
  let regions: ScanRegion[] = [];
  if (config.mode === "custom" && config.custom) {
    regions = [{ name: "自訂區域", country: "", ...config.custom }];
  } else {
    for (const packValue of config.countryPacks) {
      const definition = COUNTRY_PACK_CATALOG.find((pack) =>
        pack.id === packValue || pack.name === packValue);
      if (!definition) continue;
      for (const [name, lat, lng] of definition.cities) {
        regions.push(centerRegion(name, definition.name, lat, lng, config.radiusKm));
      }
    }
  }
  const unique = new Map(regions.map((region) => [`${region.country}\0${region.name}`, region]));
  regions = optimize([...unique.values()], currentLocation);
  if (!regions.length) throw new Error("至少選擇一個國家城市包");

  const targets: ScanTarget[] = [];
  let previous = currentLocation ?? null;
  regions.forEach((region, regionIndex) => {
    const regionCenter = center(region);
    const travelCooldown = previous
      ? Math.max(config.cooldownS, Math.min(120, distanceKm(previous, regionCenter) / 10))
      : 0;
    grid(region, config.gridStepM).forEach((point, pointIndex) => {
      targets.push({
        country: region.country,
        city: region.name,
        lat: Number(point.lat.toFixed(7)),
        lng: Number(point.lng.toFixed(7)),
        regionIndex,
        pointIndex,
        cooldownS: pointIndex === 0 ? Math.round(travelCooldown) : 0,
      });
    });
    previous = regionCenter;
  });
  if (targets.length > 10_000) {
    throw new Error(`掃描範圍產生 ${targets.length} 點，超過 10,000 點上限`);
  }
  if (config.loop && targets.length && regions.length > 1) {
    const wrap = Math.max(config.cooldownS,
      Math.min(120, distanceKm(center(regions.at(-1)!), center(regions[0])) / 10));
    targets[0].cooldownS = Math.max(targets[0].cooldownS, Math.round(wrap));
  }
  return { regions, targets };
}
