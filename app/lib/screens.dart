import 'dart:async';

import 'dart:ui' show FontFeature;

import 'package:flutter/material.dart';

import 'api.dart';

const pastels = [Color(0xFFF5D77B), Color(0xFFF2B6A0), Color(0xFFB5DAC7), Color(0xFFB8C9EE), Color(0xFFD6C0E5)];

Color hexColor(String h) => Color(int.parse('FF${h.substring(1)}', radix: 16));
String colorHex(Color c) => '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
int minutesOf(String t) => int.parse(t.substring(0, 2)) * 60 + int.parse(t.substring(3));
String hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

void toast(BuildContext context, String msg) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

/// 하단 탭: 계획 · 집중 · 목표 · 설정
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api, required this.onLogout, required this.onTheme});
  final Api api;
  final VoidCallback onLogout;
  final void Function(String) onTheme;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int tab = 0;

  @override
  void initState() {
    super.initState();
    widget.api.me().then((m) => widget.onTheme(m['preferences']['theme'])).catchError((e) {
      if (e is ApiException && e.status == 401) widget.onLogout();
    });
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      PlansTab(api: widget.api),
      FocusTab(api: widget.api, key: ValueKey('focus-$tab')),
      GoalsTab(api: widget.api),
      SettingsTab(api: widget.api, onLogout: widget.onLogout, onTheme: widget.onTheme),
    ];
    return Scaffold(
      body: SafeArea(child: pages[tab]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (i) => setState(() => tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.calendar_today_outlined), label: '계획'),
          NavigationDestination(icon: Icon(Icons.timer_outlined), label: '집중'),
          NavigationDestination(icon: Icon(Icons.flag_outlined), label: '목표'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), label: '설정'),
        ],
      ),
    );
  }
}

// ---------------- 계획 ----------------
class PlansTab extends StatefulWidget {
  const PlansTab({super.key, required this.api});
  final Api api;

  @override
  State<PlansTab> createState() => _PlansTabState();
}

class _PlansTabState extends State<PlansTab> {
  DateTime day = DateTime.now();
  List<dynamic>? plans;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final r = await widget.api.plans(ymd(day));
      if (mounted) setState(() { plans = r; error = null; });
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  void move(int d) {
    setState(() { day = day.add(Duration(days: d)); plans = null; });
    load();
  }

  Future<void> run(Future<void> Function() f) async {
    try { await f(); } catch (e) { if (mounted) toast(context, e.toString()); }
    load();
  }

  void openActions(Map p) {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(title: Text(p['title'], style: const TextStyle(fontWeight: FontWeight.bold)), subtitle: Text('${p['start']} – ${p['end']}')),
          if (p['done'] != true)
            ListTile(
              leading: const Icon(Icons.play_arrow),
              title: const Text('집중 시작하기'),
              onTap: () async {
                Navigator.pop(ctx);
                await Navigator.push(context, MaterialPageRoute(builder: (_) => Scaffold(appBar: AppBar(title: const Text('집중')), body: FocusView(api: widget.api, plan: p))));
                load();
              },
            ),
          ListTile(
            leading: Icon(p['done'] == true ? Icons.undo : Icons.check),
            title: Text(p['done'] == true ? '완료 취소' : '완료로 표시'),
            onTap: () { Navigator.pop(ctx); run(() => widget.api.updatePlan(p['id'], {'done': p['done'] != true, 'version': p['version']})); },
          ),
          ListTile(
            leading: const Icon(Icons.delete_outline),
            title: const Text('삭제'),
            onTap: () { Navigator.pop(ctx); run(() => widget.api.deletePlan(p['id'])); },
          ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final label = '${day.month}월 ${day.day}일 (${'월화수목금토일'[day.weekday - 1]})';
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final added = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => PlanForm(api: widget.api, day: day)));
          if (added == true) load();
        },
        icon: const Icon(Icons.add),
        label: const Text('계획 만들기'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
          child: Row(children: [
            IconButton(onPressed: () => move(-1), icon: const Icon(Icons.chevron_left), tooltip: '전날'),
            Expanded(child: Text(label, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge)),
            IconButton(onPressed: () => move(1), icon: const Icon(Icons.chevron_right), tooltip: '다음날'),
          ]),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: load,
            child: error != null
                ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(error!))])
                : plans == null
                    ? const Center(child: CircularProgressIndicator())
                    : plans!.isEmpty
                        ? ListView(children: const [Padding(padding: EdgeInsets.all(32), child: Text('이 날은 계획이 없어요.\n작은 계획 하나부터 시작해볼까?', textAlign: TextAlign.center))])
                        : ListView.builder(
                            padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                            itemCount: plans!.length,
                            itemBuilder: (_, i) {
                              final p = plans![i] as Map;
                              final done = p['done'] == true;
                              return Card(
                                clipBehavior: Clip.antiAlias,
                                child: InkWell(
                                  onTap: () => openActions(p),
                                  child: IntrinsicHeight(
                                    child: Row(children: [
                                      Container(width: 8, color: hexColor(p['color'])),
                                      Expanded(
                                        child: ListTile(
                                          title: Text(p['title'], style: TextStyle(decoration: done ? TextDecoration.lineThrough : null)),
                                          subtitle: Text('${p['start']} – ${p['end']}'),
                                          trailing: Checkbox(
                                            value: done,
                                            semanticLabel: '완료',
                                            onChanged: (v) => run(() => widget.api.updatePlan(p['id'], {'done': v, 'version': p['version']})),
                                          ),
                                        ),
                                      ),
                                    ]),
                                  ),
                                ),
                              );
                            },
                          ),
          ),
        ),
      ]),
    );
  }
}

class PlanForm extends StatefulWidget {
  const PlanForm({super.key, required this.api, required this.day});
  final Api api;
  final DateTime day;

  @override
  State<PlanForm> createState() => _PlanFormState();
}

class _PlanFormState extends State<PlanForm> {
  final title = TextEditingController();
  late DateTime date = widget.day;
  // 기본값: 지금부터 25분(자정을 넘으면 23:35–24:00 직전으로 맞춤)
  static final _startMin = (TimeOfDay.now().hour * 60 + TimeOfDay.now().minute).clamp(0, 1439 - 25);
  TimeOfDay start = TimeOfDay(hour: _startMin ~/ 60, minute: _startMin % 60),
      end = TimeOfDay(hour: (_startMin + 25) ~/ 60, minute: (_startMin + 25) % 60);
  Color color = pastels.first;
  String? error;
  bool busy = false;

  Future<void> pickCustomColor() async {
    final hex = TextEditingController(text: colorHex(color));
    final picked = await showDialog<Color>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('직접 조색'),
        content: TextField(controller: hex, decoration: const InputDecoration(labelText: '색상 코드 (#aabbcc)'), autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          FilledButton(
            onPressed: () {
              final v = hex.text.trim().startsWith('#') ? hex.text.trim() : '#${hex.text.trim()}';
              if (RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(v)) Navigator.pop(ctx, hexColor(v));
            },
            child: const Text('적용'),
          ),
        ],
      ),
    );
    if (picked != null) setState(() => color = picked);
  }

  Future<void> save() async {
    if (title.text.trim().isEmpty) return setState(() => error = '계획 이름을 적어주세요.');
    if (minutesOf(hhmm(end)) <= minutesOf(hhmm(start))) return setState(() => error = '끝 시간을 시작 시간 뒤로 정해주세요.');
    setState(() { busy = true; error = null; });
    try {
      await widget.api.createPlan({'title': title.text.trim(), 'date': ymd(date), 'start': hhmm(start), 'end': hhmm(end), 'color': colorHex(color)});
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() { error = e.toString(); busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('계획 만들기')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: title, maxLength: 60, decoration: const InputDecoration(labelText: '무엇을 할까?', border: OutlineInputBorder())),
        ListTile(
          leading: const Icon(Icons.event),
          title: Text('${date.year}. ${date.month}. ${date.day}.'),
          onTap: () async {
            final d = await showDatePicker(context: context, initialDate: date, firstDate: DateTime(2020), lastDate: DateTime(2100));
            if (d != null) setState(() => date = d);
          },
        ),
        Row(children: [
          Expanded(child: ListTile(leading: const Icon(Icons.schedule), title: Text('시작 ${hhmm(start)}'), onTap: () async {
            final t = await showTimePicker(context: context, initialTime: start);
            if (t != null) setState(() => start = t);
          })),
          Expanded(child: ListTile(title: Text('끝 ${hhmm(end)}'), onTap: () async {
            final t = await showTimePicker(context: context, initialTime: end);
            if (t != null) setState(() => end = t);
          })),
        ]),
        Wrap(spacing: 8, children: [
          for (final m in [25, 50, 90])
            ActionChip(label: Text('$m분'), onPressed: () {
              final e = start.hour * 60 + start.minute + m;
              if (e > 1439) return setState(() => error = '자정을 넘지 않는 시작 시간을 골라주세요.');
              setState(() => end = TimeOfDay(hour: e ~/ 60, minute: e % 60));
            }),
        ]),
        const SizedBox(height: 16),
        const Text('색깔 (같은 색을 여러 계획에 써도 괜찮아요)'),
        const SizedBox(height: 8),
        Wrap(spacing: 10, runSpacing: 10, children: [
          for (final c in pastels)
            Semantics(
              button: true,
              selected: c == color,
              label: '색 ${colorHex(c)}',
              child: GestureDetector(
                onTap: () => setState(() => color = c),
                child: CircleAvatar(radius: 20, backgroundColor: c, child: c == color ? const Icon(Icons.check, color: Colors.black87) : null),
              ),
            ),
          ActionChip(avatar: CircleAvatar(backgroundColor: color, radius: 8), label: const Text('직접 조색'), onPressed: pickCustomColor),
        ]),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 24),
        FilledButton(onPressed: busy ? null : save, child: const Padding(padding: EdgeInsets.all(14), child: Text('저장하기'))),
      ]),
    );
  }
}

// ---------------- 집중 ----------------
/// 탭에서 열면 오늘 진행 중이거나 다음 미완료 계획을 준비한다(시작은 하지 않음).
class FocusTab extends StatefulWidget {
  const FocusTab({super.key, required this.api});
  final Api api;

  @override
  State<FocusTab> createState() => _FocusTabState();
}

class _FocusTabState extends State<FocusTab> {
  Map? plan;
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    () async {
      try {
        final now = DateTime.now(), nowMin = now.hour * 60 + now.minute;
        final list = (await widget.api.plans(ymd(now))).cast<Map>();
        plan = list.where((p) => p['done'] != true && minutesOf(p['end']) > nowMin).firstOrNull;
      } catch (e) {
        error = e.toString();
      }
      if (mounted) setState(() => loading = false);
    }();
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    if (error != null) return Center(child: Text(error!));
    if (plan == null) {
      return const Center(child: Padding(padding: EdgeInsets.all(32), child: Text('지금 진행할 계획이 없어요.\n계획 탭에서 오늘 계획을 먼저 만들어볼까?', textAlign: TextAlign.center)));
    }
    return FocusView(api: widget.api, plan: plan!);
  }
}

class FocusView extends StatefulWidget {
  const FocusView({super.key, required this.api, required this.plan});
  final Api api;
  final Map plan;

  @override
  State<FocusView> createState() => _FocusViewState();
}

class _FocusViewState extends State<FocusView> with WidgetsBindingObserver {
  Map<String, dynamic>? s;
  DateTime syncedAt = DateTime.now();
  Timer? ticker;
  bool busy = false, celebrated = false;
  String? error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _do(() => widget.api.openFocus(widget.plan['id'])); // READY: ▶ 전까지 시간 안 흐름
  }

  @override
  void dispose() {
    ticker?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // 앱으로 돌아오면 서버 기준으로 남은 시간을 다시 맞춘다.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && s != null) _do(() => widget.api.focus(s!['id']));
  }

  Future<void> _do(Future<Map<String, dynamic>> Function() f) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final r = await f();
      if (!mounted) return;
      setState(() { s = r; syncedAt = DateTime.now(); error = null; });
      ticker?.cancel();
      if (r['status'] == 'RUNNING') ticker = Timer.periodic(const Duration(milliseconds: 250), (_) => _tick());
      if (r['status'] == 'COMPLETED' && !celebrated) { celebrated = true; _celebrate(); }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  int get left {
    if (s == null) return 0;
    final base = s!['remainingSec'] as int;
    if (s!['status'] != 'RUNNING') return base;
    return (base - DateTime.now().difference(syncedAt).inSeconds).clamp(0, base);
  }

  void _tick() {
    if (left == 0) { ticker?.cancel(); _do(() => widget.api.focusAction(s!['id'], 'complete')); } // 시간 종료
    else { setState(() {}); }
  }

  Future<void> _celebrate() async {
    final msg = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _Celebration(api: widget.api, plan: widget.plan),
    );
    if (msg != null && mounted) toast(context, msg);
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final status = s?['status'];
    final live = const ['READY', 'RUNNING', 'PAUSED'].contains(status);
    final total = (s?['durationSec'] as int?) ?? 1;
    final l = left;
    final clock = '${(l ~/ 60).toString().padLeft(2, '0')}:${(l % 60).toString().padLeft(2, '0')}';
    final stateText = switch (status) {
      'READY' => '준비되면 시작해볼까?',
      'RUNNING' => '집중하는 중',
      'PAUSED' => '잠깐 쉬는 중',
      'COMPLETED' => '집중 완료! 수고했어',
      'SKIPPED' => '이번엔 넘겼어. 괜찮아',
      _ => '',
    };
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(children: [
        Text(stateText, style: t.titleMedium),
        const SizedBox(height: 8),
        Image.asset('assets/mascot.png', height: 180, semanticLabel: '플잉 마스코트'),
        Text(widget.plan['title'], style: t.titleLarge, textAlign: TextAlign.center),
        Text('${widget.plan['start']} – ${widget.plan['end']} · ${total ~/ 60}분', style: t.bodyMedium),
        const SizedBox(height: 16),
        Text(clock, style: t.displayLarge?.copyWith(fontFeatures: const [FontFeature.tabularFigures()], fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        LinearProgressIndicator(value: s == null ? 0 : (total - l) / total, minHeight: 8, borderRadius: BorderRadius.circular(4)),
        const SizedBox(height: 24),
        Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
          OutlinedButton(onPressed: live && !busy ? () => _do(() => widget.api.focusAction(s!['id'], 'skip')) : null, child: const Text('넘기기')),
          SizedBox(
            width: 84,
            height: 84,
            child: FilledButton(
              style: FilledButton.styleFrom(shape: const CircleBorder(), padding: EdgeInsets.zero),
              onPressed: live && !busy ? () => _do(() => widget.api.focusAction(s!['id'], status == 'READY' ? 'start' : 'complete')) : null,
              child: Icon(status == 'READY' ? Icons.play_arrow : Icons.check, size: 40, semanticLabel: status == 'READY' ? '집중 시작' : '계획 완료'),
            ),
          ),
          OutlinedButton(
            onPressed: (status == 'RUNNING' || status == 'PAUSED') && !busy ? () => _do(() => widget.api.focusAction(s!['id'], status == 'PAUSED' ? 'resume' : 'pause')) : null,
            child: Text(status == 'PAUSED' ? '재개' : '멈춤'),
          ),
        ]),
        const SizedBox(height: 16),
        Text(status == 'READY' ? '가운데 시작 버튼을 눌러줘' : status == 'RUNNING' ? '남은 집중 시간 ${(l / 60).ceil()}분' : '', style: t.bodySmall),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      ]),
    );
  }
}

class _Celebration extends StatefulWidget {
  const _Celebration({required this.api, required this.plan});
  final Api api;
  final Map plan;

  @override
  State<_Celebration> createState() => _CelebrationState();
}

class _CelebrationState extends State<_Celebration> {
  bool busy = false;
  String? error;

  Future<void> claim() async {
    setState(() { busy = true; error = null; });
    try {
      final r = await widget.api.claimReward(widget.plan['id']);
      if (mounted) Navigator.pop(context, r['granted'] == true ? '코인 5개를 받았어요! 지금 ${r['balance']} 코인' : '이미 받은 보상이에요');
    } catch (e) {
      setState(() { busy = false; error = '보상을 저장하지 못했어요. 다시 눌러주세요.'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('오늘의 한 걸음 성공!', style: TextStyle(fontWeight: FontWeight.w600)),
        Image.asset('assets/mascot-happy.png', height: 200, semanticLabel: '기뻐하며 축하하는 플잉 마스코트'),
        Text('끝까지 해냈구나!', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 6),
        Text('${widget.plan['title']} 완료!\n조금씩 쌓인 노력이 반짝이고 있어.', textAlign: TextAlign.center),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      ]),
      actions: [
        SizedBox(
          width: double.infinity,
          child: FilledButton(onPressed: busy ? null : claim, child: const Padding(padding: EdgeInsets.all(12), child: Text('🪙 코인 5개 받기'))),
        ),
      ],
    );
  }
}

// ---------------- 목표 ----------------
class GoalsTab extends StatefulWidget {
  const GoalsTab({super.key, required this.api});
  final Api api;

  @override
  State<GoalsTab> createState() => _GoalsTabState();
}

class _GoalsTabState extends State<GoalsTab> {
  final input = TextEditingController();
  List<dynamic>? goals;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final g = await widget.api.goals();
      if (mounted) setState(() => goals = g);
    } catch (e) {
      if (mounted) toast(context, e.toString());
    }
  }

  Future<void> run(Future<void> Function() f) async {
    try { await f(); } catch (e) { if (mounted) toast(context, e.toString()); }
    load();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.all(16), children: [
      Text('나의 목표', style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: TextField(controller: input, maxLength: 60, decoration: const InputDecoration(labelText: '새 목표'))),
        IconButton.filled(
          tooltip: '목표 추가',
          icon: const Icon(Icons.add),
          onPressed: () {
            final v = input.text.trim();
            if (v.isEmpty) return;
            input.clear();
            run(() => widget.api.createGoal(v));
          },
        ),
      ]),
      if (goals == null) const Center(child: CircularProgressIndicator()),
      for (final g in goals ?? [])
        CheckboxListTile(
          value: g['done'] == true,
          title: Text(g['title'], style: TextStyle(decoration: g['done'] == true ? TextDecoration.lineThrough : null)),
          onChanged: (v) => run(() => widget.api.updateGoal(g['id'], {'done': v})),
          secondary: IconButton(icon: const Icon(Icons.delete_outline), tooltip: '삭제', onPressed: () => run(() => widget.api.deleteGoal(g['id']))),
          controlAffinity: ListTileControlAffinity.leading,
        ),
    ]);
  }
}

// ---------------- 설정 ----------------
class SettingsTab extends StatefulWidget {
  const SettingsTab({super.key, required this.api, required this.onLogout, required this.onTheme});
  final Api api;
  final VoidCallback onLogout;
  final void Function(String) onTheme;

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<SettingsTab> {
  Map<String, dynamic>? me;

  @override
  void initState() {
    super.initState();
    widget.api.me().then((m) { if (mounted) setState(() => me = m); }).catchError((e) { if (mounted) toast(context, e.toString()); });
  }

  Future<void> save(Map<String, dynamic> prefs) async {
    try {
      final m = await widget.api.updateMe({'preferences': prefs});
      setState(() => me = m);
      widget.onTheme(m['preferences']['theme']);
    } catch (e) {
      if (mounted) toast(context, e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    if (me == null) return const Center(child: CircularProgressIndicator());
    final prefs = Map<String, dynamic>.from(me!['preferences']);
    final n = Map<String, dynamic>.from(prefs['notifications']);
    Map<String, dynamic> withN(String k, Object v) => {...prefs, 'notifications': {...n, k: v}};
    return ListView(padding: const EdgeInsets.all(16), children: [
      Card(
        child: ListTile(
          leading: const Text('🪙', style: TextStyle(fontSize: 28)),
          title: Text('${me!['coins']} 코인'),
          subtitle: Text('${me!['displayName'] ?? '플잉 친구'} · ${me!['timeZone']}'),
        ),
      ),
      const SizedBox(height: 16),
      const Text('화면 테마'),
      const SizedBox(height: 8),
      SegmentedButton<String>(
        segments: const [
          ButtonSegment(value: 'system', label: Text('시스템')),
          ButtonSegment(value: 'light', label: Text('라이트')),
          ButtonSegment(value: 'dark', label: Text('다크')),
        ],
        selected: {prefs['theme']},
        onSelectionChanged: (v) => save({...prefs, 'theme': v.first}),
      ),
      const SizedBox(height: 16),
      SwitchListTile(title: const Text('계획 알림 받기'), subtitle: const Text('설정만 저장돼요. 실제 푸시 발송은 아직 연결 전이에요.'), value: n['enabled'] == true, onChanged: (v) => save(withN('enabled', v))),
      SwitchListTile(title: const Text('시작 시간에 알림'), value: n['atStart'] == true, onChanged: (v) => save(withN('atStart', v))),
      SwitchListTile(title: const Text('소리'), value: n['sound'] == true, onChanged: (v) => save(withN('sound', v))),
      ListTile(
        title: const Text('미리 알림'),
        trailing: DropdownButton<int>(
          value: n['before'] as int,
          items: const [0, 5, 10, 15].map((m) => DropdownMenuItem(value: m, child: Text(m == 0 ? '없음' : '$m분 전'))).toList(),
          onChanged: (v) => save(withN('before', v!)),
        ),
      ),
      const SizedBox(height: 24),
      OutlinedButton(onPressed: widget.onLogout, child: const Text('로그아웃')),
    ]);
  }
}
