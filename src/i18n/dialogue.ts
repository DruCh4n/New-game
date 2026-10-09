/**
 * Negotiation dialogue. Each key has several variants; one is picked per line so conversations vary.
 * Placeholders: {price} {cash} {cost} (money), {neighbor}, {year}, {n}, {city}, {gens}, {years}, {days}.
 * Owner lines are first person; player lines describe what you do.
 */
export type DialogueTable = Record<string, string[]>;

const en: DialogueTable = {
  // ---------- greetings ----------
  'greet.warm': [
    'Oh, welcome, welcome! Come in, sit. Would you like some tea?',
    'Ah, the developer! People talk about you. Please, have a seat.',
    'Come in, come in. My wife just made fried bananas, try one.',
  ],
  'greet.neutral': [
    'Yes? You must be the one buying up houses around here.',
    'Good afternoon. I heard you might come by.',
    'Please sit. I don\'t have much time, but let\'s hear it.',
    'So you\'re the developer. What can I do for you?',
  ],
  'greet.cold': [
    'You again? Say what you came to say.',
    'I know why you\'re here. Make it quick.',
    'Hmph. I\'m only letting you in because my mother taught me manners.',
  ],
  'greet.again.warm': ['Back again! Come in, the kettle is still warm.', 'Ah, you came back. Sit, sit.'],
  'greet.again.neutral': ['You came back. Have you thought about it more?', 'Again? Fine, let\'s talk.'],
  'greet.again.cold': ['You don\'t give up, do you.', 'I thought I made myself clear last time.'],
  'greet.company': [
    'Good morning. Our director asked me to hear your proposal.',
    'Thank you for coming. Let\'s keep this businesslike.',
  ],
  'greet.institution': [
    'Assalamualaikum. The board has asked me to meet you.',
    'Welcome. Any decision here must be taken together with the board.',
  ],
  'greet.state': [
    'Good morning. Land acquisition requests go through this office. Do you have the documents?',
    'Please take a number. ... Ah, the developer. What parcel are you applying for?',
  ],

  // ---------- remarks at the start ----------
  'remark.neighborSold': [
    'I heard {neighbor} already sold to you.',
    '{neighbor} told me about your offer. They seem happy.',
    'So {neighbor} sold. The street won\'t be the same.',
  ],
  'remark.manySold': [
    'Half the street has sold already. I don\'t want to be the last one left between the construction.',
    'Everyone around me is leaving. {neighbor} too. Maybe it\'s time.',
  ],
  'remark.rumorGenerous': [
    'People say you paid very well for the houses nearby. I expect the same respect.',
    'I heard what you gave my neighbours. Don\'t think I\'ll take less.',
  ],
  'remark.lowRep': [
    'People say you don\'t treat folks fairly. I\'ll be careful.',
    'Your name isn\'t very good around here, you know.',
  ],
  'remark.highRep': [
    'Everyone says you\'re an honest developer. That counts for something.',
    'The RT head speaks well of you.',
  ],

  // ---------- personal stories (spoken when listening) ----------
  'story.warung': [
    'Half the kampung buys their breakfast at my warung. Where would they eat if I left?',
    'This warung feeds my family. Every morning at five I\'m already frying tempeh.',
  ],
  'story.workshop': ['My customers know where to find me. A mechanic without a place is just a man with a spanner.'],
  'story.tailor': ['Every school uniform in this street was sewn on that machine by the window.'],
  'story.laundry': ['My laundry customers come from three streets away. The location is everything.'],
  'story.investor': ['I have properties all over the city. For me this is a number on a spreadsheet, nothing more.'],
  'story.farmer': ['My family has planted rice here for {gens} generations. The soil knows our hands.'],
  'story.pension': ['I live on a small pension. I just want a quiet life without surprises.'],
  'story.shopFamily': ['This shop has been in the family for {years} years. My grandfather opened it with one shelf of rice.'],
  'story.fatherBuilt': [
    'My late father built this house in {year}. He carried every brick himself.',
    'See that crack in the wall? My father fixed it in {year}, the year he built this place. I never repaired it.',
  ],
  'story.siblings': ['This house belongs to me and my {n} siblings. If one says no, it\'s no.'],
  'story.kidsSchool': [
    'My {n} children walk to school from here. Where would they go?',
    'The kids are at the school around the corner. Moving them now would break their hearts.',
  ],
  'story.elderParent': ['My mother lives with us. She can\'t climb stairs anymore. A tower block is no good for her.'],
  'story.medicalDebt': ['I won\'t lie. The hospital bills from last year are still heavy on us.'],
  'story.businessDebt': ['My business went badly. The debt collectors call every week.'],
  'story.schoolFees': ['My eldest got into university. The fees... I lie awake thinking about them.'],
  'story.wantsMove': ['To be honest, I\'ve wanted to move closer to family in {city} for years.'],
  'story.newlyBought': ['I only bought this place {years} year(s) ago. It was an investment, really.'],
  'story.newlyweds': ['We just got married. We were going to raise our children here.'],
  'story.mangoTree': ['That mango tree was planted the day I was born. You would cut it down, wouldn\'t you?'],
  'story.birds': ['Listen to them sing. My birds won competitions. They won\'t sing in an apartment.'],
  'story.garden': ['Every pot here has a chilli plant. My wife says I love them more than her.'],
  'story.kos': ['I rent rooms to students. That rent pays our bills every month.'],
  'story.rtHead': ['I\'m the RT head. People here watch what I do. If I sell, many will follow.'],
  'story.wedding': ['All three of my children held their weddings in this house. The tent went right across the street.'],
  'story.neverLeave': ['I was born in this house and I will die in this house.'],
  'story.companyExpand': ['Frankly, the company could use capital for a new branch.'],
  'story.companyRent': ['We rent this out. If the numbers work, we sell. Simple.'],
  'story.companyIdle': ['The building is underused. The board has been asking what to do with it.'],
  'story.waqf': ['This land was given to God as wakaf. It is not ours to sell.'],
  'story.foundation': ['The foundation decides slowly, by consensus. Patience is required.'],
  'story.stateLand': ['This is public land.'],

  // ---------- hints from listening ----------
  'hint.cash': ['Honestly? Cash is what matters to me. The rest is just talk.', 'Show me a good number and we\'ll be fine.'],
  'hint.apartment': [
    'If I could still live in this neighbourhood, in a new place, it would be easier to say yes.',
    'I don\'t want to leave this area. Our whole life is here.',
  ],
  'hint.moving': ['Moving a family this size costs a fortune. Trucks, deposits, everything.', 'Even the cost of moving out scares me.'],
  'hint.relocation': [
    'At my age, I wouldn\'t even know how to find a new house.',
    'If someone helped us find a good place nearby, I\'d sleep better.',
  ],
  'hint.shop': [
    'My customers are my livelihood. Without a shop, I have nothing.',
    'If I could keep selling in the same area, with a proper shop, now that would interest me.',
  ],
  'hint.holdout': [
    'Let me be clear before you waste your breath: this house is not for sale. Not to you, not to anyone.',
    'You can talk all day. I am not going anywhere.',
  ],
  'listen.again': ['We\'ve talked enough. What\'s your offer?', 'I\'ve told you everything. Now, the number.'],
  'listen.state': ['Parcels are sold at the assessed value plus administration fees. Reputation of the applicant is considered.'],

  // ---------- reactions to offers ----------
  'offer.insult': [
    'Is this a joke? That wouldn\'t buy a chicken coop.',
    'You come into my house and insult me like this?',
    'Get out. No, wait, I\'m too polite. But that number is shameful.',
    'My neighbours will hear about this offer, believe me.',
  ],
  'offer.low': [
    'That\'s far below what this place is worth.',
    'No, no. Not even close.',
    'You\'ll have to do much better than that.',
    'I know what the house down the road sold for. Try again.',
  ],
  'counter.first': [
    'I could accept {price}. Not a rupiah less.',
    'Make it {price} and we can talk seriously.',
    'For {price}, maybe. I\'d have to think about it, but maybe.',
  ],
  'counter.next': [
    'Alright, you\'re getting closer. {price}.',
    'Fine. {price}, and I\'m being generous.',
    'We\'re close. {price} and we shake hands.',
  ],
  'counter.final': [
    '{price}. That\'s my final word.',
    'I can\'t go lower than {price}. Take it or leave it.',
  ],
  'option.like.apartment': ['A new apartment here, in the neighbourhood? Now that I like.', 'We could stay near our friends... that means a lot.'],
  'option.like.shop': ['A shop unit in the new building? My customers would follow me!', 'A proper shop. I\'ve dreamed of that.'],
  'option.like.moving': ['You\'d pay for the move? That helps a lot.', 'Moving costs covered... good, good.'],
  'option.like.relocation': ['You would help us find a new place? That takes a weight off my shoulders.'],
  'option.dislike.apartment': ['An apartment? I don\'t want to live in a box in the sky.', 'Stairs and lifts... no, that\'s not for us.'],
  'option.dislike.shop': ['A shop? What would I do with a shop? I\'m not a trader.'],
  'option.dislike.moving': ['Moving costs are the least of my concerns.'],
  'option.dislike.relocation': ['I can find my own house, thank you.'],

  // ---------- outcomes ----------
  'accept.happy': [
    '{price}... yes. Yes! This will change everything for us. Thank you.',
    'Deal! My wife will cry with joy. {price}!',
    'Alhamdulillah. {price}, we accept.',
  ],
  'accept.sad': [
    '{price}. ...My father would understand. Times change.',
    'Alright. {price}. Give me a moment to look at the old house one more time.',
    'I\'ll sign. But promise me you\'ll build something good here.',
  ],
  'accept.neutral': ['{price}. We have a deal.', 'Fine, {price}. Let\'s shake on it.', 'Agreed. {price}, and the papers by the end of the month.'],
  'accept.company': ['{price}. The board will approve. Pleasure doing business.', 'Agreed at {price}. Our lawyers will contact yours.'],
  'state.accept': ['Your application for {price} is approved. Please collect the certificate at counter three.'],
  'state.reject': [
    'The minimum price for this parcel is {price}. Your application is incomplete.',
    'We cannot approve less than {price}, including administration.',
  ],
  'state.lowRep': ['Considering the complaints we\'ve received about your company, we cannot process this application.'],

  // ---------- refusals ----------
  'refuse.holdout': [
    'I will leave this house only feet first. Please go.',
    'No amount of money. Not now, not ever.',
    'You can build your towers around me. I\'m staying.',
    'This isn\'t about money. The answer is no, and it will always be no.',
  ],
  'refuse.institution': ['This land is wakaf. It cannot be sold. Please understand.', 'The board will never agree to sell. It is not ours to sell.'],
  'refuse.park': ['Public parks are not for sale. Perhaps in a district plan, later.'],
  'refuse.tired': ['I\'m tired. Come back another day.', 'Enough for today. Let me think about it.', 'My head hurts. Another time.'],
  'refuse.angry': ['Don\'t come here again.', 'I have nothing more to say to you. Leave.', 'Out. And tell your people not to come either.'],
  'refuse.wontMeet': ['They are not receiving visitors right now. Try again in {days} day(s).'],

  // ---------- gifts and pressure ----------
  'gift.thanks': [
    'Oh, you shouldn\'t have! Please, sit down, have some more tea.',
    'Martabak! The kids will love it. Thank you.',
    'How thoughtful. Come, sit closer.',
  ],
  'gift.again': ['You already brought something. Let\'s talk business.'],
  'gift.refuseState': ['We do not accept gifts. This will be noted in your file.'],
  'pressure.works': [
    '...Alright, alright. Maybe we can talk about a lower price.',
    'If the whole street is changing... I suppose I can\'t fight it forever.',
  ],
  'pressure.backfire': [
    'Are you threatening me? In my own house?',
    'Get out! I\'ll tell everyone how you work.',
    'I\'ve survived floods and floods of developers. You don\'t scare me.',
  ],
  'pressure.state': ['Intimidating a public official? I will pretend I didn\'t hear that.'],

  // ---------- player actions (shown on the right) ----------
  'player.offer': ['You offer {cash}.'],
  'player.acceptCounter': ['You accept {cash}.'],
  'player.listen': ['You sit and listen.'],
  'player.gift': ['You bring a gift ({cost}).'],
  'player.pressure': ['You hint that the neighbourhood will change, with or without them.'],
  'player.leave': ['You thank them and leave.'],

  // ---------- system notes ----------
  'system.visit': ['Visit {n}'],
  'system.sold': ['Sold to you for {price}.'],
};

const id: DialogueTable = {
  'greet.warm': [
    'Oh, mari, mari! Masuk, duduk. Mau teh?',
    'Wah, ini dia pengembangnya! Orang-orang sering membicarakan Anda. Silakan duduk.',
    'Masuk, masuk. Istri saya baru goreng pisang, cobalah.',
  ],
  'greet.neutral': [
    'Ya? Anda pasti yang membeli rumah-rumah di sekitar sini.',
    'Selamat siang. Saya dengar Anda akan mampir.',
    'Silakan duduk. Saya tidak punya banyak waktu, tapi mari kita dengar.',
    'Jadi Anda pengembangnya. Ada yang bisa saya bantu?',
  ],
  'greet.cold': [
    'Anda lagi? Katakan saja maksud Anda.',
    'Saya tahu kenapa Anda ke sini. Cepat saja.',
    'Hmm. Saya persilakan masuk hanya karena ibu saya mengajari sopan santun.',
  ],
  'greet.again.warm': ['Datang lagi! Masuk, ketelnya masih hangat.', 'Ah, Anda kembali. Duduk, duduk.'],
  'greet.again.neutral': ['Anda datang lagi. Sudah dipikirkan lagi?', 'Lagi? Baiklah, mari bicara.'],
  'greet.again.cold': ['Anda tidak menyerah, ya.', 'Saya kira kemarin sudah jelas.'],
  'greet.company': [
    'Selamat pagi. Direktur kami meminta saya mendengarkan proposal Anda.',
    'Terima kasih sudah datang. Mari kita bicara secara profesional.',
  ],
  'greet.institution': [
    'Assalamualaikum. Pengurus meminta saya menemui Anda.',
    'Selamat datang. Setiap keputusan di sini harus diambil bersama pengurus.',
  ],
  'greet.state': [
    'Selamat pagi. Permohonan pengadaan tanah melalui kantor ini. Dokumennya sudah lengkap?',
    'Silakan ambil nomor antrean. ... Ah, pengembang. Persil mana yang Anda ajukan?',
  ],
  'remark.neighborSold': [
    'Saya dengar {neighbor} sudah menjual ke Anda.',
    '{neighbor} cerita soal tawaran Anda. Kelihatannya dia senang.',
    'Jadi {neighbor} sudah jual. Jalan ini tidak akan sama lagi.',
  ],
  'remark.manySold': [
    'Separuh jalan sudah menjual. Saya tidak mau jadi yang terakhir terjepit di antara proyek.',
    'Semua orang di sekitar saya pergi. {neighbor} juga. Mungkin sudah waktunya.',
  ],
  'remark.rumorGenerous': [
    'Kata orang, Anda membayar mahal rumah-rumah di sekitar sini. Saya harap diperlakukan sama.',
    'Saya dengar berapa yang Anda berikan ke tetangga. Jangan kira saya mau lebih sedikit.',
  ],
  'remark.lowRep': ['Kata orang, Anda tidak adil pada warga. Saya akan hati-hati.', 'Nama Anda kurang baik di sini, lho.'],
  'remark.highRep': ['Semua bilang Anda pengembang yang jujur. Itu ada artinya.', 'Pak RT memuji Anda.'],
  'story.warung': [
    'Separuh kampung sarapan di warung saya. Kalau saya pergi, mereka makan di mana?',
    'Warung ini menghidupi keluarga saya. Jam lima pagi saya sudah menggoreng tempe.',
  ],
  'story.workshop': ['Pelanggan saya tahu di mana mencari saya. Montir tanpa tempat cuma orang yang pegang kunci pas.'],
  'story.tailor': ['Semua seragam sekolah di jalan ini dijahit di mesin dekat jendela itu.'],
  'story.laundry': ['Pelanggan laundry saya datang dari tiga gang jauhnya. Lokasi itu segalanya.'],
  'story.investor': ['Saya punya properti di seluruh kota. Bagi saya ini cuma angka di tabel.'],
  'story.farmer': ['Keluarga saya menanam padi di sini selama {gens} generasi. Tanah ini kenal tangan kami.'],
  'story.pension': ['Saya hidup dari pensiun kecil. Saya cuma ingin hidup tenang tanpa kejutan.'],
  'story.shopFamily': ['Toko ini sudah {years} tahun di keluarga kami. Kakek saya membukanya dengan satu rak beras.'],
  'story.fatherBuilt': [
    'Almarhum bapak saya membangun rumah ini tahun {year}. Beliau mengangkut setiap batanya sendiri.',
    'Lihat retakan di dinding itu? Bapak menambalnya tahun {year}, tahun beliau membangun rumah ini. Tidak pernah saya perbaiki.',
  ],
  'story.siblings': ['Rumah ini milik saya dan {n} saudara saya. Kalau satu bilang tidak, ya tidak.'],
  'story.kidsSchool': [
    '{n} anak saya jalan kaki ke sekolah dari sini. Mereka mau ke mana?',
    'Anak-anak sekolah di ujung gang. Memindahkan mereka sekarang akan menyakiti hati mereka.',
  ],
  'story.elderParent': ['Ibu saya tinggal bersama kami. Beliau sudah tidak bisa naik tangga. Rusun tidak cocok untuknya.'],
  'story.medicalDebt': ['Terus terang, tagihan rumah sakit tahun lalu masih berat buat kami.'],
  'story.businessDebt': ['Usaha saya bangkrut. Penagih utang menelepon tiap minggu.'],
  'story.schoolFees': ['Anak sulung saya diterima di universitas. Biayanya... saya sampai tidak bisa tidur.'],
  'story.wantsMove': ['Jujur saja, sudah bertahun-tahun saya ingin pindah dekat keluarga di {city}.'],
  'story.newlyBought': ['Saya baru beli tempat ini {years} tahun lalu. Sebenarnya untuk investasi.'],
  'story.newlyweds': ['Kami baru menikah. Rencananya kami besarkan anak-anak di sini.'],
  'story.mangoTree': ['Pohon mangga itu ditanam waktu saya lahir. Anda pasti akan menebangnya, kan?'],
  'story.birds': ['Dengar kicauannya. Burung-burung saya juara lomba. Di apartemen mereka tidak akan berkicau.'],
  'story.garden': ['Setiap pot di sini ada cabainya. Istri saya bilang saya lebih sayang cabai daripada dia.'],
  'story.kos': ['Saya menyewakan kamar kos untuk mahasiswa. Uang sewanya membayar tagihan kami tiap bulan.'],
  'story.rtHead': ['Saya ketua RT. Warga melihat apa yang saya lakukan. Kalau saya jual, banyak yang ikut.'],
  'story.wedding': ['Ketiga anak saya menikah di rumah ini. Tendanya sampai menutup jalan.'],
  'story.neverLeave': ['Saya lahir di rumah ini dan saya akan meninggal di rumah ini.'],
  'story.companyExpand': ['Terus terang, perusahaan butuh modal untuk cabang baru.'],
  'story.companyRent': ['Kami menyewakan tempat ini. Kalau angkanya cocok, kami jual. Sederhana.'],
  'story.companyIdle': ['Gedungnya kurang terpakai. Direksi sudah lama bertanya mau diapakan.'],
  'story.waqf': ['Tanah ini sudah diwakafkan. Bukan hak kami untuk menjualnya.'],
  'story.foundation': ['Yayasan memutuskan perlahan, secara musyawarah. Harus sabar.'],
  'story.stateLand': ['Ini tanah publik.'],
  'hint.cash': ['Jujur? Yang penting bagi saya uang tunai. Sisanya cuma omongan.', 'Tunjukkan angka yang bagus, kita pasti cocok.'],
  'hint.apartment': [
    'Kalau saya masih bisa tinggal di lingkungan ini, di tempat baru, lebih mudah bilang ya.',
    'Saya tidak mau meninggalkan daerah ini. Seluruh hidup kami di sini.',
  ],
  'hint.moving': ['Pindahan dengan keluarga sebesar ini mahal sekali. Truk, uang muka, semuanya.', 'Biaya pindahnya saja sudah bikin saya takut.'],
  'hint.relocation': [
    'Di umur saya, saya bahkan tidak tahu cara mencari rumah baru.',
    'Kalau ada yang membantu kami mencari tempat bagus di dekat sini, saya lebih tenang.',
  ],
  'hint.shop': [
    'Pelanggan adalah mata pencaharian saya. Tanpa toko, saya tidak punya apa-apa.',
    'Kalau saya bisa tetap berjualan di daerah ini, dengan toko yang layak, itu baru menarik.',
  ],
  'hint.holdout': [
    'Biar saya tegaskan sebelum Anda buang tenaga: rumah ini tidak dijual. Tidak untuk Anda, tidak untuk siapa pun.',
    'Silakan bicara seharian. Saya tidak akan ke mana-mana.',
  ],
  'listen.again': ['Kita sudah cukup bicara. Berapa tawaran Anda?', 'Saya sudah cerita semuanya. Sekarang, angkanya.'],
  'listen.state': ['Persil dijual sesuai nilai taksiran ditambah biaya administrasi. Reputasi pemohon juga dipertimbangkan.'],
  'offer.insult': [
    'Ini bercanda? Segitu tidak cukup untuk beli kandang ayam.',
    'Anda datang ke rumah saya dan menghina seperti ini?',
    'Keluar. Eh, tidak, saya terlalu sopan. Tapi angka itu memalukan.',
    'Tetangga saya akan dengar soal tawaran ini, percayalah.',
  ],
  'offer.low': [
    'Itu jauh di bawah harga tempat ini.',
    'Tidak, tidak. Jauh sekali.',
    'Anda harus menawar jauh lebih baik dari itu.',
    'Saya tahu rumah di ujung jalan laku berapa. Coba lagi.',
  ],
  'counter.first': [
    'Saya bisa terima {price}. Tidak kurang serupiah pun.',
    'Jadikan {price} dan kita bisa bicara serius.',
    'Kalau {price}, mungkin. Harus saya pikirkan, tapi mungkin.',
  ],
  'counter.next': ['Baik, Anda makin dekat. {price}.', 'Ya sudah. {price}, dan itu saya sudah murah hati.', 'Sudah dekat. {price} dan kita salaman.'],
  'counter.final': ['{price}. Itu kata terakhir saya.', 'Saya tidak bisa lebih rendah dari {price}. Mau atau tidak.'],
  'option.like.apartment': ['Apartemen baru di sini, di lingkungan ini? Nah, itu saya suka.', 'Kami bisa tetap dekat teman-teman... itu sangat berarti.'],
  'option.like.shop': ['Unit toko di gedung baru? Pelanggan saya pasti ikut!', 'Toko yang layak. Sudah lama saya impikan.'],
  'option.like.moving': ['Anda yang bayar pindahan? Itu sangat membantu.', 'Biaya pindah ditanggung... bagus, bagus.'],
  'option.like.relocation': ['Anda mau bantu kami cari tempat baru? Itu meringankan beban saya.'],
  'option.dislike.apartment': ['Apartemen? Saya tidak mau tinggal di kotak di langit.', 'Tangga dan lift... tidak, itu bukan untuk kami.'],
  'option.dislike.shop': ['Toko? Mau saya apakan toko? Saya bukan pedagang.'],
  'option.dislike.moving': ['Biaya pindah itu urusan paling kecil bagi saya.'],
  'option.dislike.relocation': ['Saya bisa cari rumah sendiri, terima kasih.'],
  'accept.happy': ['{price}... ya. Ya! Ini akan mengubah segalanya bagi kami. Terima kasih.', 'Sepakat! Istri saya pasti menangis bahagia. {price}!', 'Alhamdulillah. {price}, kami terima.'],
  'accept.sad': [
    '{price}. ...Bapak pasti mengerti. Zaman berubah.',
    'Baiklah. {price}. Beri saya waktu untuk melihat rumah tua ini sekali lagi.',
    'Saya tanda tangan. Tapi janji, bangun sesuatu yang baik di sini.',
  ],
  'accept.neutral': ['{price}. Kita sepakat.', 'Baik, {price}. Mari salaman.', 'Setuju. {price}, dan surat-suratnya akhir bulan.'],
  'accept.company': ['{price}. Direksi akan menyetujui. Senang berbisnis dengan Anda.', 'Setuju di {price}. Pengacara kami akan menghubungi Anda.'],
  'state.accept': ['Permohonan Anda senilai {price} disetujui. Silakan ambil sertifikatnya di loket tiga.'],
  'state.reject': ['Harga minimum persil ini {price}. Permohonan Anda belum lengkap.', 'Kami tidak bisa menyetujui di bawah {price}, termasuk administrasi.'],
  'state.lowRep': ['Mengingat banyaknya keluhan tentang perusahaan Anda, permohonan ini tidak dapat kami proses.'],
  'refuse.holdout': [
    'Saya hanya akan keluar dari rumah ini dalam keranda. Silakan pergi.',
    'Berapa pun uangnya. Tidak sekarang, tidak selamanya.',
    'Silakan bangun menara di sekeliling saya. Saya tetap di sini.',
    'Ini bukan soal uang. Jawabannya tidak, dan akan selalu tidak.',
  ],
  'refuse.institution': ['Tanah ini wakaf. Tidak bisa dijual. Mohon dimengerti.', 'Pengurus tidak akan pernah setuju menjual. Ini bukan milik kami.'],
  'refuse.park': ['Taman umum tidak dijual. Mungkin nanti, dalam rencana kawasan.'],
  'refuse.tired': ['Saya capek. Datang lagi lain hari.', 'Cukup untuk hari ini. Biar saya pikirkan.', 'Kepala saya pusing. Lain kali saja.'],
  'refuse.angry': ['Jangan datang ke sini lagi.', 'Tidak ada lagi yang perlu saya katakan. Pergi.', 'Keluar. Dan bilang orang-orang Anda juga jangan datang.'],
  'refuse.wontMeet': ['Mereka sedang tidak menerima tamu. Coba lagi dalam {days} hari.'],
  'gift.thanks': ['Aduh, tidak usah repot-repot! Silakan duduk, tambah tehnya.', 'Martabak! Anak-anak pasti suka. Terima kasih.', 'Perhatian sekali. Mari, duduk lebih dekat.'],
  'gift.again': ['Anda sudah membawa sesuatu. Mari bicara bisnis.'],
  'gift.refuseState': ['Kami tidak menerima hadiah. Ini akan dicatat dalam berkas Anda.'],
  'pressure.works': ['...Ya sudah, ya sudah. Mungkin kita bisa bicara harga yang lebih rendah.', 'Kalau seluruh jalan berubah... saya tidak bisa melawan selamanya.'],
  'pressure.backfire': ['Anda mengancam saya? Di rumah saya sendiri?', 'Keluar! Akan saya ceritakan ke semua orang cara kerja Anda.', 'Saya sudah selamat dari banjir dan banjir pengembang. Anda tidak membuat saya takut.'],
  'pressure.state': ['Mengintimidasi pejabat publik? Saya anggap tidak mendengar itu.'],
  'player.offer': ['Anda menawar {cash}.'],
  'player.acceptCounter': ['Anda menerima {cash}.'],
  'player.listen': ['Anda duduk dan mendengarkan.'],
  'player.gift': ['Anda membawa oleh-oleh ({cost}).'],
  'player.pressure': ['Anda menyiratkan bahwa lingkungan ini akan berubah, dengan atau tanpa mereka.'],
  'player.leave': ['Anda berterima kasih dan pamit.'],
  'system.visit': ['Kunjungan {n}'],
  'system.sold': ['Dijual kepada Anda seharga {price}.'],
};

export const dialogue: Record<string, DialogueTable> = { en, id };
