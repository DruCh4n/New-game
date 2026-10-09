import type { Rng } from '../util/random';

export type Gender = 'm' | 'f';

interface NameSet {
  male: string[];
  female: string[];
  family: string[];
  /** Builds the full name; default "first family". */
  compose?(first: string, family: string, gender: Gender, rng: Rng): string;
  /** Polite prefix by gender/age, e.g. Pak / Bu / Mbah. */
  honorific?(gender: Gender, age: number): string;
  cities: string[];
}

const SETS: Record<string, NameSet> = {
  ID: {
    male: ['Budi', 'Agus', 'Slamet', 'Joko', 'Bambang', 'Hadi', 'Wahyu', 'Eko', 'Dedi', 'Rudi', 'Sutrisno', 'Haryanto',
      'Supriyadi', 'Ahmad', 'Muhammad', 'Rizky', 'Iwan', 'Teguh', 'Yusuf', 'Hendra', 'Bayu', 'Gunawan', 'Sugeng',
      'Purnomo', 'Darto', 'Suparman', 'Arif', 'Fajar', 'Imam', 'Rahmat', 'Sigit', 'Wawan', 'Yanto', 'Heru'],
    female: ['Siti', 'Sri', 'Dewi', 'Rina', 'Wati', 'Nur', 'Endang', 'Yuni', 'Ani', 'Lestari', 'Ratna', 'Kartini',
      'Suharti', 'Tuti', 'Fitri', 'Indah', 'Rahmawati', 'Sulastri', 'Murni', 'Ayu', 'Puji', 'Sumiati', 'Wulan',
      'Yati', 'Erna', 'Nining', 'Mariam', 'Dian', 'Kusuma', 'Partini'],
    family: ['Santoso', 'Wijaya', 'Susanto', 'Hidayat', 'Saputra', 'Kurniawan', 'Setiawan', 'Pratama', 'Nugroho',
      'Wibowo', 'Hartono', 'Utomo', 'Prasetyo', 'Suryadi', 'Siregar', 'Nasution', 'Simanjuntak', 'Lubis',
      'Handoko', 'Purnomo', 'Sudarsono', 'Suharto', 'Rahayu', 'Lestari', 'Wahyuni', 'Halim', 'Tanoto', 'Gunadi'],
    compose: (first, family, g, rng) => (rng.chance(0.3) ? first : `${first} ${g === 'f' && family === 'Saputra' ? 'Saputri' : family}`),
    honorific: (g, age) => (age >= 72 ? 'Mbah' : g === 'm' ? 'Pak' : 'Bu'),
    cities: ['Surabaya', 'Bandung', 'Semarang', 'Medan', 'Makassar', 'Malang', 'Solo', 'Jakarta', 'Bali'],
  },
  MY: {
    male: ['Ahmad', 'Mohd', 'Ismail', 'Hafiz', 'Azman', 'Rizal', 'Faizal', 'Kamal', 'Wei Ming', 'Kumar', 'Rajesh', 'Chee Keong'],
    female: ['Siti', 'Nurul', 'Aisyah', 'Farah', 'Zainab', 'Mei Ling', 'Priya', 'Kavitha', 'Hui Min', 'Rohani'],
    family: ['Ismail', 'Hassan', 'Abdullah', 'Rahman', 'Yusof', 'Tan', 'Lim', 'Wong', 'Lee', 'Subramaniam', 'Raj'],
    compose: (first, family, g) => (['Tan', 'Lim', 'Wong', 'Lee'].includes(family) ? `${family} ${first}` : `${first} ${g === 'f' ? 'binti' : 'bin'} ${family}`),
    honorific: (g, age) => (age >= 70 ? (g === 'm' ? 'Tok' : 'Nek') : g === 'm' ? 'Encik' : 'Puan'),
    cities: ['Kuala Lumpur', 'Penang', 'Johor Bahru', 'Ipoh', 'Melaka', 'Kota Kinabalu'],
  },
  TH: {
    male: ['Somchai', 'Somsak', 'Prasert', 'Anan', 'Wichai', 'Narong', 'Chatchai', 'Kittisak', 'Suchart', 'Thongchai'],
    female: ['Malee', 'Somsri', 'Ratana', 'Siriporn', 'Pranee', 'Wanida', 'Kanya', 'Nittaya', 'Duangjai', 'Achara'],
    family: ['Srisuk', 'Wongsakul', 'Chaiyaporn', 'Saetang', 'Boonmee', 'Rattanakul', 'Sukprasert', 'Thongdee', 'Charoensuk'],
    honorific: (g, age) => (age >= 70 ? (g === 'm' ? 'Ta' : 'Yai') : 'Khun'),
    cities: ['Bangkok', 'Chiang Mai', 'Khon Kaen', 'Hat Yai', 'Udon Thani', 'Phuket'],
  },
  PH: {
    male: ['Jose', 'Juan', 'Antonio', 'Ricardo', 'Eduardo', 'Rogelio', 'Mark', 'Jerome', 'Ramon', 'Danilo'],
    female: ['Maria', 'Rosario', 'Teresita', 'Cristina', 'Jennifer', 'Marites', 'Lourdes', 'Ana', 'Grace', 'Erlinda'],
    family: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Dela Cruz', 'Ramos', 'Villanueva', 'Aquino'],
    honorific: (g, age) => (age >= 70 ? (g === 'm' ? 'Lolo' : 'Lola') : g === 'm' ? 'Mang' : 'Aling'),
    cities: ['Cebu', 'Davao', 'Manila', 'Iloilo', 'Baguio', 'Cagayan de Oro'],
  },
  VN: {
    male: ['Văn An', 'Văn Bình', 'Minh Tuấn', 'Quốc Hùng', 'Đức Thắng', 'Văn Hải', 'Thanh Sơn', 'Hữu Phúc'],
    female: ['Thị Lan', 'Thị Hoa', 'Thu Hà', 'Ngọc Anh', 'Thị Mai', 'Thanh Hương', 'Thị Hạnh', 'Kim Liên'],
    family: ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Đặng', 'Bùi', 'Đỗ'],
    compose: (first, family) => `${family} ${first}`,
    honorific: (g, age) => (age >= 70 ? (g === 'm' ? 'Ông' : 'Bà') : g === 'm' ? 'Anh' : 'Chị'),
    cities: ['Hà Nội', 'Đà Nẵng', 'Huế', 'Cần Thơ', 'Hải Phòng', 'Nha Trang'],
  },
};

const DEFAULT_SET: NameSet = {
  male: ['James', 'Daniel', 'Michael', 'David', 'Thomas', 'Samuel', 'Lucas', 'Omar', 'Carlos', 'Hiro', 'Ali', 'Peter'],
  female: ['Mary', 'Sarah', 'Emma', 'Laura', 'Fatima', 'Elena', 'Grace', 'Anna', 'Sofia', 'Yuki', 'Amara', 'Ruth'],
  family: ['Smith', 'Brown', 'Garcia', 'Müller', 'Rossi', 'Novak', 'Khan', 'Silva', 'Okafor', 'Tanaka', 'Haddad', 'Jensen'],
  honorific: (g) => (g === 'm' ? 'Mr.' : 'Mrs.'),
  cities: ['the capital', 'the coast', 'the next city', 'abroad'],
};

export function nameSet(country: string | undefined): NameSet {
  return (country && SETS[country.toUpperCase()]) || DEFAULT_SET;
}

export function generatePersonName(country: string | undefined, gender: Gender, rng: Rng, family?: string): { name: string; family: string } {
  const set = nameSet(country);
  const first = rng.pick(gender === 'm' ? set.male : set.female);
  const fam = family ?? rng.pick(set.family);
  const name = set.compose ? set.compose(first, fam, gender, rng) : `${first} ${fam}`;
  return { name, family: fam };
}

export function honorific(country: string | undefined, gender: Gender, age: number): string {
  return nameSet(country).honorific?.(gender, age) ?? '';
}

export function randomCity(country: string | undefined, rng: Rng): string {
  return rng.pick(nameSet(country).cities);
}
