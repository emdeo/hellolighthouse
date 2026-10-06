const https = require('https');
const fs = require('fs');

const API_KEY = process.env.LIGHTHOUSE_API_KEY;
const NUM_OF_ROWS = 40;

function fetchPage(pageNo) {
  return new Promise((resolve, reject) => {
    const url = 'https://apis.data.go.kr/1192136/Buoy/getBuoyInfo'
      + '?serviceKey=' + API_KEY
      + '&buoyNm=A01'
      + '&pageNo=' + pageNo
      + '&numOfRows=' + NUM_OF_ROWS
      + '&type=xml';
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function parseItems(xml) {
  xml = xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;');
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map(item => {
    const get = (tag) => {
      const m = item.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
      if (!m) return '';
      return m[1].trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    };
    const latStr = get('wgs84North').replace('N', '').replace('S', '-');
    const lngStr = get('wgs84East').replace('E', '').replace('W', '-');
    return {
      id: get('blfrNo'),
      name: get('buoyKr').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
      nameEn: get('buoyEn'),
      type: get('buoyNm'),
      sea: get('seaNm'),
      light: get('lgt_property'),
      lat: parseFloat(latStr),
      lng: parseFloat(lngStr)
    };
  }).filter(d => d.lat && d.lng);
}

function isKorea(lat, lng) {
  if (lat < 33.0 || lat > 38.63) return false;
  if (lng < 124.0 || lng > 132.0) return false;
  if (lat >= 38.0) return lng >= 128.0 && lng <= 130.0;
  return true;
}

async function main() {
  console.log('API 호출 시작...');
  let allItems = [];

  const countUrl = 'https://apis.data.go.kr/1192136/Buoy/getBuoyInfo?serviceKey=' + API_KEY + '&buoyNm=A01&pageNo=1&numOfRows=1&type=xml';
  const countXml = await new Promise((resolve, reject) => {
    https.get(countUrl, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
  const totalCountMatch = countXml.match(/<totalCount>(\d+)<\/totalCount>/);
  const totalCount = totalCountMatch ? parseInt(totalCountMatch[1]) : 0;
  const totalPages = Math.ceil(totalCount / NUM_OF_ROWS);
  console.log('전체 데이터 수:', totalCount, '/ 총 페이지:', totalPages);

  for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
    console.log('페이지', pageNo, '호출 중...');
    let items = [];
for (let retry = 0; retry < 3; retry++) {
  try {
    const xml = await fetchPage(pageNo);
    items = parseItems(xml);
    if (items.length > 0) break;
  } catch (err) {
    console.log('페이지', pageNo, '재시도', retry + 1, ':', err.message);
    await new Promise(r => setTimeout(r, 1000));
  }
}
console.log('페이지', pageNo, '파싱 결과:', items.length, '개');
allItems = allItems.concat(items);
  }

  console.log('전체 항목:', allItems.length);

  const EXCLUDE_IDS = ["1204_A","2537.2","3306.5","3901"];

  const filtered = allItems
    .filter(d => d.name.includes('등대'))
    .filter(d => !d.name.includes('조사등'))
    .filter(d => isKorea(d.lat, d.lng))
    .filter(d => !EXCLUDE_IDS.includes(d.id));

  console.log('필터링 후:', filtered.length);

  const output = 'const LIGHTHOUSE_DATA =\n' + JSON.stringify(filtered, null, 2);
  fs.writeFileSync('lighthouses.js', output);
  console.log('lighthouses.js 저장 완료');
}

main().catch(err => {
  console.error('오류 발생:', err);
  process.exit(1);
});
