import JSZip from 'jszip';
import { escapeHtml } from './util';
import type { Extracted } from './ooxml';

// Scratch 3 opcode -> readable Vietnamese label. (X) = input, [X] = field.
const L: Record<string, string> = {
  event_whenflagclicked: 'khi bấm vào lá cờ xanh',
  event_whenkeypressed: 'khi bấm phím [KEY_OPTION]',
  event_whenthisspriteclicked: 'khi bấm vào nhân vật này',
  event_whenstageclicked: 'khi bấm vào sân khấu',
  event_whenbroadcastreceived: 'khi nhận tin [BROADCAST_OPTION]',
  event_whenbackdropswitchesto: 'khi phông nền chuyển thành [BACKDROP]',
  event_whengreaterthan: 'khi [WHENGREATERTHANMENU] > (VALUE)',
  event_broadcast: 'phát tin (BROADCAST_INPUT)',
  event_broadcastandwait: 'phát tin (BROADCAST_INPUT) và đợi',
  motion_movesteps: 'di chuyển (STEPS) bước',
  motion_turnright: 'xoay phải (DEGREES) độ',
  motion_turnleft: 'xoay trái (DEGREES) độ',
  motion_goto: 'đi tới (TO)',
  motion_gotoxy: 'đi tới x: (X) y: (Y)',
  motion_glideto: 'lướt trong (SECS) giây tới (TO)',
  motion_glidesecstoxy: 'lướt trong (SECS) giây tới x: (X) y: (Y)',
  motion_pointindirection: 'hướng về (DIRECTION) độ',
  motion_pointtowards: 'hướng về phía (TOWARDS)',
  motion_changexby: 'thay đổi x một lượng (DX)',
  motion_setx: 'đặt x bằng (X)',
  motion_changeyby: 'thay đổi y một lượng (DY)',
  motion_sety: 'đặt y bằng (Y)',
  motion_ifonedgebounce: 'nếu chạm cạnh thì bật lại',
  motion_setrotationstyle: 'đặt kiểu xoay [STYLE]',
  motion_xposition: 'hoành độ x',
  motion_yposition: 'tung độ y',
  motion_direction: 'hướng',
  looks_sayforsecs: 'nói (MESSAGE) trong (SECS) giây',
  looks_say: 'nói (MESSAGE)',
  looks_thinkforsecs: 'nghĩ (MESSAGE) trong (SECS) giây',
  looks_think: 'nghĩ (MESSAGE)',
  looks_switchcostumeto: 'chuyển sang trang phục (COSTUME)',
  looks_nextcostume: 'trang phục kế tiếp',
  looks_switchbackdropto: 'chuyển phông nền thành (BACKDROP)',
  looks_switchbackdroptoandwait: 'chuyển phông nền thành (BACKDROP) và đợi',
  looks_nextbackdrop: 'phông nền kế tiếp',
  looks_changesizeby: 'thay đổi kích thước một lượng (CHANGE)',
  looks_setsizeto: 'đặt kích thước thành (SIZE) %',
  looks_changeeffectby: 'thay đổi hiệu ứng [EFFECT] một lượng (CHANGE)',
  looks_seteffectto: 'đặt hiệu ứng [EFFECT] thành (VALUE)',
  looks_cleargraphiceffects: 'bỏ các hiệu ứng đồ họa',
  looks_show: 'hiện',
  looks_hide: 'ẩn',
  looks_gotofrontback: 'đi tới lớp [FRONT_BACK]',
  looks_goforwardbackwardlayers: 'đi [FORWARD_BACKWARD] (NUM) lớp',
  looks_costumenumbername: 'trang phục [NUMBER_NAME]',
  looks_size: 'kích thước',
  sound_playuntildone: 'phát âm thanh (SOUND_MENU) đến hết',
  sound_play: 'phát âm thanh (SOUND_MENU)',
  sound_stopallsounds: 'dừng tất cả âm thanh',
  sound_changevolumeby: 'thay đổi âm lượng một lượng (VOLUME)',
  sound_setvolumeto: 'đặt âm lượng (VOLUME) %',
  control_wait: 'đợi (DURATION) giây',
  control_repeat: 'lặp lại (TIMES) lần',
  control_forever: 'liên tục',
  control_if: 'nếu (CONDITION) thì',
  control_if_else: 'nếu (CONDITION) thì',
  control_wait_until: 'đợi đến khi (CONDITION)',
  control_repeat_until: 'lặp lại cho đến khi (CONDITION)',
  control_stop: 'dừng lại [STOP_OPTION]',
  control_start_as_clone: 'khi tôi bắt đầu là một bản sao',
  control_create_clone_of: 'tạo bản sao của (CLONE_OPTION)',
  control_delete_this_clone: 'xóa bản sao này',
  sensing_touchingobject: 'đang chạm (TOUCHINGOBJECTMENU)?',
  sensing_touchingcolor: 'đang chạm màu (COLOR)?',
  sensing_coloristouchingcolor: 'màu (COLOR) đang chạm màu (COLOR2)?',
  sensing_distanceto: 'khoảng cách đến (DISTANCETOMENU)',
  sensing_askandwait: 'hỏi (QUESTION) và đợi',
  sensing_answer: 'câu trả lời',
  sensing_keypressed: 'phím (KEY_OPTION) được bấm?',
  sensing_mousedown: 'chuột được nhấn?',
  sensing_mousex: 'chuột x',
  sensing_mousey: 'chuột y',
  sensing_timer: 'đồng hồ bấm giờ',
  sensing_resettimer: 'đặt lại đồng hồ bấm giờ',
  operator_add: '((NUM1) + (NUM2))',
  operator_subtract: '((NUM1) - (NUM2))',
  operator_multiply: '((NUM1) * (NUM2))',
  operator_divide: '((NUM1) / (NUM2))',
  operator_random: 'số ngẫu nhiên từ (FROM) đến (TO)',
  operator_gt: '<(OPERAND1) > (OPERAND2)>',
  operator_lt: '<(OPERAND1) < (OPERAND2)>',
  operator_equals: '<(OPERAND1) = (OPERAND2)>',
  operator_and: '<(OPERAND1) và (OPERAND2)>',
  operator_or: '<(OPERAND1) hoặc (OPERAND2)>',
  operator_not: '<không phải (OPERAND)>',
  operator_join: 'kết hợp (STRING1) với (STRING2)',
  operator_letter_of: 'kí tự thứ (LETTER) của (STRING)',
  operator_length: 'độ dài của (STRING)',
  operator_contains: '(STRING1) chứa (STRING2)?',
  operator_mod: '((NUM1) chia lấy dư (NUM2))',
  operator_round: 'làm tròn (NUM)',
  operator_mathop: '[OPERATOR] của (NUM)',
  data_setvariableto: 'đặt [VARIABLE] thành (VALUE)',
  data_changevariableby: 'thay đổi [VARIABLE] một lượng (VALUE)',
  data_showvariable: 'hiện biến [VARIABLE]',
  data_hidevariable: 'ẩn biến [VARIABLE]',
  data_addtolist: 'thêm (ITEM) vào [LIST]',
  data_deleteoflist: 'xóa mục (INDEX) của [LIST]',
  data_deletealloflist: 'xóa tất cả của [LIST]',
  data_insertatlist: 'chèn (ITEM) tại vị trí (INDEX) của [LIST]',
  data_replaceitemoflist: 'thay mục (INDEX) của [LIST] bằng (ITEM)',
  data_itemoflist: 'mục (INDEX) của [LIST]',
  data_lengthoflist: 'độ dài của [LIST]',
  data_listcontainsitem: '[LIST] chứa (ITEM)?',
  pen_clear: 'xóa tất cả (bút vẽ)',
  pen_penDown: 'đặt bút',
  pen_penUp: 'nhấc bút',
  pen_stamp: 'đóng dấu',
  pen_setPenColorToColor: 'đặt màu bút thành (COLOR)',
  pen_changePenSizeBy: 'thay đổi nét bút một lượng (SIZE)',
  pen_setPenSizeTo: 'đặt nét bút thành (SIZE)',
};

type Block = { opcode: string; next: string | null; parent: string | null; inputs: Record<string, any[]>; fields: Record<string, any[]>; topLevel?: boolean; shadow?: boolean; x?: number; y?: number; mutation?: any };

export async function extractSb3(buf: ArrayBuffer): Promise<Extracted> {
  const zip = await JSZip.loadAsync(buf);
  const pj = zip.file('project.json');
  if (!pj) throw new Error('Không phải file Scratch 3 (.sb3) hợp lệ.');
  const project = JSON.parse(await pj.async('string'));
  const lines: string[] = [];
  const analysis: string[] = [];
  const usage: Record<string, number> = {};
  let totalBlocks = 0;
  let totalScripts = 0;

  for (const target of project.targets || []) {
    const blocks: Record<string, Block> = target.blocks || {};
    const name = target.isStage ? 'Sân khấu' : `Nhân vật "${target.name}"`;
    const costumes = (target.costumes || []).map((c: any) => c.name);
    const sounds = (target.sounds || []).map((s: any) => s.name);
    const vars = Object.values(target.variables || {}).map((v: any) => v[0]);
    const lists = Object.values(target.lists || {}).map((v: any) => v[0]);

    const val = (inp: any[] | undefined): string => {
      if (!inp) return '';
      const v = inp[1];
      if (v == null) return '';
      if (typeof v === 'string') return render(v, true);
      if (Array.isArray(v)) {
        if (v[0] === 12 || v[0] === 13) return `[${v[1]}]`;
        return String(v[1]);
      }
      return '';
    };
    const render = (id: string, inline = false): string => {
      const b = blocks[id];
      if (!b || typeof b !== 'object') return '';
      if (!b.shadow) {
        totalBlocks++;
        usage[b.opcode.split('_')[0]] = (usage[b.opcode.split('_')[0]] || 0) + 1;
      }
      if (b.opcode === 'data_variable') return `[${b.fields?.VARIABLE?.[0]}]`;
      if (b.opcode === 'data_listcontents') return `[${b.fields?.LIST?.[0]}]`;
      if (b.opcode === 'argument_reporter_string_number' || b.opcode === 'argument_reporter_boolean') return `(${b.fields?.VALUE?.[0]})`;
      if (b.shadow || /_menu$|menu$/i.test(b.opcode)) {
        const f = Object.values(b.fields || {})[0];
        return f ? String(f[0]) : '';
      }
      if (b.opcode === 'procedures_definition') {
        const proto = blocks[b.inputs?.custom_block?.[1] as string];
        return `định nghĩa khối "${proto?.mutation?.proccode || '?'}"`;
      }
      if (b.opcode === 'procedures_call') {
        let i = 0;
        const ids: string[] = JSON.parse(b.mutation?.argumentids || '[]');
        return `gọi khối "${String(b.mutation?.proccode || '?').replace(/%[sbn]/g, () => `(${val(b.inputs?.[ids[i++]])})`)}"`;
      }
      const tpl = L[b.opcode];
      if (!tpl) {
        const args = [...Object.entries(b.fields || {}).map(([k, f]) => `${k}=${f[0]}`), ...Object.entries(b.inputs || {}).filter(([k]) => !k.startsWith('SUBSTACK')).map(([k, x]) => `${k}=${val(x)}`)];
        return `${b.opcode}${args.length ? ` (${args.join(', ')})` : ''}`;
      }
      const s = tpl.replace(/\((\w+)\)/g, (_, k) => (b.inputs?.[k] ? `(${val(b.inputs[k])})` : '()')).replace(/\[(\w+)\]/g, (_, k) => `[${b.fields?.[k]?.[0] ?? val(b.inputs?.[k]) ?? ''}]`);
      return inline ? s : s;
    };
    const stack = (id: string | null, depth: number, out: string[]) => {
      let cur = id;
      let guard = 0;
      while (cur && blocks[cur] && guard++ < 2000) {
        const b = blocks[cur];
        out.push('  '.repeat(depth) + render(cur));
        if (b.inputs?.SUBSTACK) stack(b.inputs.SUBSTACK[1] as string, depth + 1, out);
        if (b.opcode === 'control_if_else') {
          out.push('  '.repeat(depth) + 'không thì');
          if (b.inputs?.SUBSTACK2) stack(b.inputs.SUBSTACK2[1] as string, depth + 1, out);
        }
        if (/control_(repeat|forever|if|repeat_until|if_else)$/.test(b.opcode)) out.push('  '.repeat(depth) + 'kết thúc');
        cur = b.next;
      }
    };
    const tops = Object.entries(blocks)
      .filter(([, b]) => b && typeof b === 'object' && b.topLevel && !b.shadow)
      .sort(([, a], [, b]) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
    lines.push(`=== ${name} ===`);
    if (!tops.length) lines.push('(không có khối lệnh)');
    tops.forEach(([id], i) => {
      const out: string[] = [];
      stack(id, 1, out);
      totalScripts++;
      lines.push(`Kịch bản ${i + 1}:`, ...out);
    });
    analysis.push(
      `${name}: ${costumes.length} ${target.isStage ? 'phông nền' : 'trang phục'} (${costumes.slice(0, 8).join(', ')}); ${sounds.length} âm thanh; ${tops.length} kịch bản` +
        (vars.length ? `; biến: ${vars.join(', ')}` : '') + (lists.length ? `; danh sách: ${lists.join(', ')}` : '') +
        (!target.isStage ? `; vị trí x=${Math.round(target.x)}, y=${Math.round(target.y)}, kích thước ${Math.round(target.size)}%, ${target.visible ? 'hiện' : 'ẩn'}` : '')
    );
  }
  const sprites = (project.targets || []).filter((t: any) => !t.isStage).length;
  analysis.unshift(`Tổng: ${sprites} nhân vật, ${totalScripts} kịch bản, ${totalBlocks} khối lệnh. Khối theo nhóm: ${Object.entries(usage).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const text = lines.join('\n');
  return { text, analysis: analysis.join('\n'), html: `<pre class="code">${escapeHtml(text)}</pre>`, images: [], warnings: totalBlocks ? [] : ['Bài Scratch không có khối lệnh nào.'] };
}
