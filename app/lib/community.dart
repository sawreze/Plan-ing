import 'package:flutter/material.dart';

import 'api.dart';

class ChatTab extends StatefulWidget {
  const ChatTab({super.key, required this.api});
  final Api api;
  @override
  State<ChatTab> createState() => _ChatTabState();
}

class _ChatTabState extends State<ChatTab> {
  final input = TextEditingController();
  final scroll = ScrollController();
  final List<Map<String, dynamic>> messages = [
    {
      'role': 'assistant',
      'content': '안녕! 계획대로 안 되는 날도 괜찮아. 공부하다 막힌 점이나 마음에 걸리는 일을 편하게 이야기해줘. 같이 작은 방법부터 찾아보자.',
    },
  ];
  String? conversation;
  bool busy = false;
  @override
  void dispose() {
    input.dispose();
    scroll.dispose();
    super.dispose();
  }

  Future<void> send() async {
    final text = input.text.trim();
    if (text.isEmpty || busy) return;
    input.clear();
    setState(() {
      busy = true;
      messages.add({'role': 'user', 'content': text});
    });
    try {
      final r = await widget.api.call('POST', '/chat/messages', {
        'message': text,
        if (conversation != null) 'conversationId': conversation,
      });
      if (!mounted) return;
      setState(() {
        conversation = r['conversationId'];
        messages.add({
          'role': 'assistant',
          'content': r['reply'],
          'proposal': r['proposal'],
        });
      });
    } catch (e) {
      if (mounted) {
        setState(
          () => messages.add({'role': 'assistant', 'content': e.toString()}),
        );
      }
    } finally {
      if (mounted) {
        setState(() => busy = false);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (scroll.hasClients) {
            scroll.animateTo(
              scroll.position.maxScrollExtent,
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOut,
            );
          }
        });
      }
    }
  }

  Future<void> apply(Map<String, dynamic> message) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await widget.api.call(
        'POST',
        '/chat/proposals/${message['proposal']['id']}/apply',
      );
      if (mounted) setState(() => message['applied'] = true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const CircleAvatar(
              backgroundImage: AssetImage('assets/mascot.png'),
            ),
            const SizedBox(width: 12),
            Text('플잉과 이야기', style: Theme.of(context).textTheme.titleLarge),
          ],
        ),
      ),
      Expanded(
        child: ListView.builder(
          controller: scroll,
          padding: const EdgeInsets.all(16),
          itemCount: messages.length,
          itemBuilder: (_, i) {
            final m = messages[i],
                mine = m['role'] == 'user',
                proposal = m['proposal'];
            return Align(
              alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
              child: Container(
                constraints: const BoxConstraints(maxWidth: 310),
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: mine
                      ? Theme.of(context).colorScheme.primaryContainer
                      : Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(m['content']),
                    if (proposal != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        '${proposal['changes']['date'] ?? ''} ${proposal['changes']['start']} – ${proposal['changes']['end']}',
                      ),
                      FilledButton(
                        onPressed: busy || m['applied'] == true
                            ? null
                            : () => apply(m),
                        child: Text(
                          m['applied'] == true ? '변경 완료' : '이렇게 변경하기',
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            );
          },
        ),
      ),
      Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: input,
                maxLength: 2000,
                minLines: 1,
                maxLines: 4,
                decoration: const InputDecoration(
                  hintText: '일정이나 공부 고민을 말해줘',
                  counterText: '',
                ),
              ),
            ),
            IconButton.filled(
              onPressed: busy ? null : send,
              icon: busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.arrow_upward),
            ),
          ],
        ),
      ),
    ],
  );
}

class CrewScreen extends StatefulWidget {
  const CrewScreen({super.key, required this.api});
  final Api api;
  @override
  State<CrewScreen> createState() => _CrewScreenState();
}

class _CrewScreenState extends State<CrewScreen> {
  List<dynamic>? crews;
  String? error;
  bool busy = false;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final r = await widget.api.call('GET', '/crews');
      if (mounted) {
        setState(() {
          crews = r;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> create() async {
    final name = TextEditingController(), goal = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('함께하는 크루 만들기'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: name,
              maxLength: 40,
              decoration: const InputDecoration(labelText: '크루 이름'),
            ),
            TextField(
              controller: goal,
              maxLength: 80,
              decoration: const InputDecoration(labelText: '같이 이룰 목표'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('만들기'),
          ),
        ],
      ),
    );
    if (ok == true &&
        name.text.trim().isNotEmpty &&
        goal.text.trim().isNotEmpty) {
      try {
        await widget.api.call('POST', '/crews', {
          'name': name.text.trim(),
          'goal': goal.text.trim(),
          'category': '공부 습관',
        });
        await load();
      } catch (e) {
        if (mounted) setState(() => error = e.toString());
      }
    }
    name.dispose();
    goal.dispose();
  }

  Future<void> join() async {
    final code = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('참여 코드로 함께하기'),
        content: TextField(
          controller: code,
          decoration: const InputDecoration(labelText: '참여 코드'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('참여'),
          ),
        ],
      ),
    );
    if (ok == true) {
      try {
        await widget.api.call('POST', '/crews/join', {
          'code': code.text.trim(),
        });
        await load();
      } catch (e) {
        if (mounted) setState(() => error = e.toString());
      }
    }
    code.dispose();
  }

  Future<void> detail(Map crew) async {
    try {
      final c = await widget.api.call('GET', '/crews/${crew['id']}');
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(c['name']),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c['goal']),
                const SizedBox(height: 12),
                Text('멤버 ${c['members'].length}명'),
                for (final m in c['members']) Text(m['displayName']),
                const SizedBox(height: 12),
                const Text('참여 코드'),
                SelectableText(c['code']),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('닫기'),
            ),
            FilledButton(
              onPressed: () async {
                try {
                  await widget.api.call('POST', '/crews/${c['id']}/goal');
                  if (ctx.mounted) Navigator.pop(ctx);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('내 목표에 담았어요.')),
                    );
                  }
                } catch (e) {
                  if (mounted) setState(() => error = e.toString());
                }
              },
              child: const Text('내 목표에 담기'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('함께하는 크루')),
    body: RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Expanded(
                child: FilledButton(
                  onPressed: create,
                  child: const Text('크루 만들기'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  onPressed: join,
                  child: const Text('코드로 참여'),
                ),
              ),
            ],
          ),
          if (error != null)
            Padding(padding: const EdgeInsets.all(12), child: Text(error!)),
          if (crews == null && error == null)
            const Center(child: CircularProgressIndicator()),
          for (final c in crews ?? [])
            Card(
              child: ListTile(
                title: Text(c['name']),
                subtitle: Text('${c['goal']} · ${c['memberCount']}명'),
                onTap: () => detail(c),
              ),
            ),
          if (crews?.isEmpty == true)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('같은 목표로 함께할 크루를 만들어보자.'),
            ),
        ],
      ),
    ),
  );
}

class StudyTypeScreen extends StatefulWidget {
  const StudyTypeScreen({super.key, required this.api});
  final Api api;
  @override
  State<StudyTypeScreen> createState() => _StudyTypeScreenState();
}

class _StudyTypeScreenState extends State<StudyTypeScreen> {
  final Set<int> needs = {};
  int? reset;
  Map? result;
  bool busy = false;
  String? error;
  Future<void> submit() async {
    setState(() => busy = true);
    try {
      final r = await widget.api.call('POST', '/survey', {
        'q1': null,
        'q2': needs.toList(),
        'q3': reset,
      });
      if (mounted) setState(() => result = r['result']);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('나의 공부 방식')),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text('계획할 때 어떤 점이 어려워?'),
        for (var i = 0; i < 4; i++)
          CheckboxListTile(
            title: Text(
              ['뭐부터 할지 모르겠어요', '세운 계획을 못 지켜요', '시간이 늘 모자라요', '쉴 틈을 못 만들어요'][i],
            ),
            value: needs.contains(i),
            onChanged: (v) => setState(() {
              if (v == true) {
                needs.add(i);
              } else {
                needs.remove(i);
              }
            }),
          ),
        const SizedBox(height: 12),
        const Text('일정이 하나 밀리면 그날 계획을 다 놓아 버린다'),
        SegmentedButton<int>(
          segments: const [
            ButtonSegment(value: 0, label: Text('그런 편이에요')),
            ButtonSegment(value: 1, label: Text('아니에요')),
          ],
          selected: reset == null ? <int>{} : {reset!},
          emptySelectionAllowed: true,
          onSelectionChanged: (s) =>
              setState(() => reset = s.isEmpty ? null : s.first),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: busy || reset == null ? null : submit,
          child: const Text('내 유형 알아보기'),
        ),
        if (error != null) Text(error!),
        if (result != null) ...[
          const SizedBox(height: 20),
          Center(child: Image.asset('assets/mascot-pink.png', height: 70)),
          Center(
            child: Text(
              result!['name'],
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          ),
          const Center(child: Text('재정비하고 다시 시작')),
          SizedBox(
            height: 220,
            child: LayoutBuilder(
              builder: (context, c) => Stack(
                children: [
                  GridView.count(
                    crossAxisCount: 2,
                    childAspectRatio: c.maxWidth / 220,
                    physics: const NeverScrollableScrollPhysics(),
                    children: [
                      for (final name in [
                        '차분한 설계자',
                        '차근차근 실천가',
                        '자유로운 탐험가',
                        '유연한 도전가',
                      ])
                        Container(
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                            border: Border.all(
                              color: Theme.of(context)
                                  .colorScheme
                                  .outlineVariant,
                            ),
                          ),
                          child: Text(name),
                        ),
                    ],
                  ),
                  Positioned(
                    left: c.maxWidth * (result!['x'] as num) / 100 - 14,
                    top: 220 * (result!['y'] as num) / 100 - 14,
                    child: const CircleAvatar(radius: 14, child: Text('나')),
                  ),
                ],
              ),
            ),
          ),
          const Center(child: Text('유연하게 이어가기')),
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [Text('스스로 시작'), Text('작은 안내와 시작')],
          ),
          const Padding(
            padding: EdgeInsets.only(top: 16),
            child: Text('설문 답변으로 살펴본 공부 방식이야. 상황과 경험에 따라 달라질 수 있어.'),
          ),
        ],
      ],
    ),
  );
}
