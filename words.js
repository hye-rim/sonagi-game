'use strict';

// 떨어지는 단어들. 단계가 오를수록 뒤쪽 묶음(긴 단어)이 더 자주 나온다.
const list = (s) => s.trim().split(/\s+/);

const WORDS = {
  ko: [
    // 1: 두 글자
    list(`
      사과 바다 하늘 구름 우산 나무 학교 친구 가방 연필 공책 시계 의자 책상 거울 창문 우유 과자 사탕 모자
      신발 양말 바지 치마 장갑 안경 지갑 열쇠 전화 기차 버스 택시 배추 감자 호박 오이 딸기 수박 참외 포도
      자두 앵두 토끼 사슴 여우 늑대 사자 기린 하마 오리 거위 참새 제비 까치 고래 상어 문어 새우 조개 가을
      여름 겨울 봄비 아침 저녁 새벽 오늘 내일 노을 바람 번개 천둥 안개 이슬 서리 햇살 달빛 별빛 파도 모래
      자갈 바위 언덕 계곡 들판 노래 그림 편지 선물 약속 기억 추억 마음 사랑 우정 용기 희망 행복 웃음 눈물
      걱정 생각 사람 가족 엄마 아빠 동생 누나 언니 삼촌 이모 고모 아기 소년 소녀 어른 학생 의사 가수 배우
      요리 운동 축구 야구 농구 배구 수영 등산 여행 소풍 캠핑 낚시 독서 영화 음악 사진 게임 퍼즐 김치 라면
      국수 만두 떡국 김밥 갈비 순대 어묵 호떡 빙수 커피 녹차 주스 콜라 식당 도시 시골 마을 거리 공원 광장
      시장 은행 병원 약국 서점 극장 공항 항구 다리 터널 골목 지붕 마당 노트 화면 소리 전기 전등 난로 부채
      이불 베개 수건 비누 치약 칫솔 걸레 휴지 봉투 풍선 인형 로봇 공룡 우주 로켓 장화 우비 빗물 새싹 꽃잎
    `),
    // 2: 세 글자
    list(`
      자동차 비행기 자전거 지하철 냉장고 세탁기 컴퓨터 휴대폰 선풍기 에어컨 청소기 고양이 강아지 호랑이
      코끼리 원숭이 다람쥐 거북이 개구리 잠자리 메뚜기 달팽이 부엉이 민들레 진달래 개나리 무궁화 장미꽃
      소나무 단풍잎 대나무 도서관 박물관 미술관 체육관 수영장 놀이터 운동장 주차장 편의점 백화점 우체국
      소방서 경찰서 기차역 바닷가 시냇물 폭포수 무지개 소나기 눈사람 눈싸움 썰매장 해돋이 보름달 초승달
      별자리 은하수 햄버거 떡볶이 된장국 비빔밥 불고기 삼겹살 짜장면 팥빙수 초콜릿 케이크 선생님 할머니
      어머니 아버지 이웃집 반려견 요리사 소방관 경찰관 과학자 음악가 생일날 운동회 방학식 졸업식 입학식
      발표회 일기장 사진첩 즐거움 고마움 따뜻함 새로움 귀여움 씩씩함 튼튼함 우주선 외계인 손수건 빗방울
      빗소리 먹구름 흰구름 가랑비 이슬비 여우비 장맛비 도토리 솔방울 밤송이 피아노 태권도 줄넘기 보물섬
      해적선 맞춤법 오락실 햄스터 봄바람 가을비 첫눈길 아이들 기다림 도깨비 산책길 약수터 연못가
    `),
    // 3: 네 글자 이상, 사자성어
    list(`
      세종대왕 해바라기 코스모스 오토바이 텔레비전 바이올린 숨바꼭질 술래잡기 물웅덩이 천둥소리 비밀번호
      샌드위치 아이스크림 크리스마스 롤러코스터 스마트폰 인공지능 우주정거장 해수욕장 무지개다리
      소나기구름 눈꽃송이 벚꽃놀이 가을하늘 겨울방학 여름휴가 타자연습 받아쓰기 띄어쓰기 빗방울소리
      일석이조 동문서답 작심삼일 대기만성 유비무환 우공이산 과유불급 금상첨화 설상가상 이심전심
      다다익선 역지사지 온고지신 청출어람 적반하장 주경야독 자업자득 전화위복 새옹지마 호사다마
      고진감래 일취월장 박학다식 동고동락 사필귀정 인과응보 천고마비 막상막하 어부지리 조삼모사
    `),
  ],

  en: [
    list(`
      cat dog sun sky sea car bus map pen cup box hat red run fun toy egg ice key zoo
      bag bed boy girl fish bird tree rain snow wind moon star book desk door milk cake
    `),
    list(`
      apple water happy smile cloud storm light music dance dream heart plant river ocean
      tiger zebra horse mouse pizza bread juice candy sugar honey lemon mango peach grape
      house chair table phone clock watch train plane beach field grass stone world earth
    `),
    list(`
      keyboard computer umbrella rainbow thunder lightning mountain elephant giraffe dinosaur
      butterfly chocolate sandwich hamburger strawberry pineapple watermelon basketball
      adventure treasure festival birthday universe galaxy planet rocket astronaut journey
      practice challenge together friendship wonderful beautiful excellent imagination
    `),
  ],
};

if (typeof module !== 'undefined') module.exports = { WORDS };
