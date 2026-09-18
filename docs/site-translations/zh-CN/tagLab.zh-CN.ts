/** Simplified Chinese dictionary for the tiarinhino.com Tag Lab
 *  (src/components/tags/labI18n.ts on the site).
 *
 *  FOR COMMUNITY REVIEW ONLY — after approval, TAG_DOCS_ZH / HERO_TAG_DOCS_ZH
 *  and ZH are pasted into labI18n.ts, 'zh-CN': ZH is added to LAB_DICTS, and
 *  this file is removed from the repo.
 *
 *  Review notes:
 *  - Tag names (hard_cc, waveclear, must/avoid chips) are dataset identifiers
 *    and stay in English by design; only their explanations localize.
 *  - Terminology follows the in-app zh-CN localization (硬控制 / 清线 /
 *    救援队友 / 号位 / 先天能力 / 天赋).
 */

import type { TagDoc } from './tagDocs';
import type { LabDict } from './labI18n';

export const TAG_DOCS_ZH: Record<string, TagDoc> = {
    hard_cc: {
        label: '硬控制',
        meaning: '眩晕、妖术、嘲讽、恐惧或睡眠——目标完全失去控制。',
        effect: '2–5 号位的最高优先需求（范围硬控还能额外满足 3 号位的控制需求）。软控制按半个硬控计入这些需求。',
    },
    soft_cc: {
        label: '软控制',
        meaning: '减速、缠绕、沉默或缴械——限制目标但不完全剥夺控制。',
        effect: '在控制需求中按硬控的一半计算：有贡献，但评分永远不会超过真正的硬控。',
    },
    setup_cc: {
        label: '铺垫控制',
        meaning: '需要后续衔接才能生效的延迟或位置型控制（Cold Feet 一类）。',
        effect: '4 号位的小幅加成（游走开团侧重）。',
    },
    aoe: {
        label: '范围效果',
        meaning: '效果作用于一片区域或多个单位。',
        effect: '与硬控组合时满足 3 号位的「范围控制」需求；否则仅作描述。',
    },
    nuke: {
        label: '爆发伤害',
        meaning: '用于制造击杀压力的主动爆发伤害。',
        effect: '2 号位的首要需求；同时是 4–5 号位「清线或爆发」需求的另一半。',
    },
    waveclear: {
        label: '清线',
        meaning: '无需装备即可在相对安全的位置高效清掉或推掉一波兵线。',
        effect: '满足 4–5 号位的兵线需求（优先级高于救援）和 1 号位的发育替代项；2 号位小幅加成。',
    },
    farm_tool: {
        label: '发育手段',
        meaning: '把发育速度提到一波兵线之外：打野或速刷手段（Devour、顺劈、幻象）。',
        effect: '1 号位的第二优先需求；在 4–5 号位受罚（贪婪选择侧重）。',
    },
    steroid: {
        label: '攻击强化',
        meaning: '强化你自己的普攻：攻速、攻击力、暴击、重击、顺劈、攻击特效。',
        effect: '1 号位的定义性需求（最高优先）；在 4–5 号位受罚。',
    },
    sustain_self: {
        label: '自我续航',
        meaning: '为自身提供治疗、恢复、护盾或吸血。',
        effect: '满足 1 号位的生存需求和 3 号位的承伤需求；1–2 号位小幅加成（高手会为坦度付出真实代价）。',
    },
    save_ally: {
        label: '救援队友',
        meaning: '可以对队友施放：救人、治疗、护盾或驱散。',
        effect: '5 号位需求（低于硬控和清线——高手数据显示救援属于奢侈品）；在 1 号位受罚。',
    },
    team_aura: {
        label: '团队光环',
        meaning: '被动惠及队友的光环或团队增益（含法力恢复）。',
        effect: '3 号位和 5 号位的小幅加成。',
    },
    mobility: {
        label: '机动',
        meaning: '移动你的英雄：闪烁、跳跃、冲锋、大幅加速。',
        effect: '满足 1、2、4 号位的需求（优先级最低——装备可以弥补）。',
    },
    initiation: {
        label: '先手开团',
        meaning: '按你的节奏开启战斗：强制接战、远程铺垫、切入手段。',
        effect: '3 号位需求，4 号位加成。',
    },
    summon: {
        label: '召唤',
        meaning: '创造可操控的单位（真正的召唤物；幻象类技能改标为发育/续航）。',
        effect: '暂不影响评分——为考虑微操水平的推荐预留。',
    },
    teamfight_ult: {
        label: '团战大招',
        meaning: '扭转战局的大型范围投入型技能（Black Hole 一类）。',
        effect: '2 号位的需求替代项，3 号位加成。',
    },
    passive_value: {
        label: '省心被动',
        meaning: '零操作、零发育也能产生实际贡献（Corrosive Skin 一类）。',
        effect: '满足 3 号位的承伤需求；1 号位加成，2 号位小幅惩罚（中单要的是主动节奏）。辅助没有加成——辅助需要的是不吃发育的主动技能，而多数高价值被动要靠发育才成型。',
    },
    melee_only: {
        label: '仅近战可用',
        meaning: '在远程英雄模型上机制性失效或严重残缺。',
        effect: '硬过滤：当你的模型是远程时，从推荐中排除。',
    },
    ranged_only: {
        label: '仅远程可用',
        meaning: '在近战英雄模型上机制性失效或严重残缺。',
        effect: '硬过滤：当你的模型是近战时，从推荐中排除。例外：技能自己的本体模型，以及已选到 grants_ranged 技能的征召。',
    },
    grants_ranged: {
        label: '赋予远程',
        meaning: '让近战模型获得类似远程的攻击（Psi Blades、Take Aim）——足以让 ranged_only 技能正常工作。',
        effect: '一旦选到，ranged_only 技能会重新出现在近战模型的推荐中（硬过滤解除）。',
    },
    good_with_rearm: {
        label: '适配 Rearm',
        meaning: '短循环反复施放仍保持全部价值、且没有每次施放限制——值得围绕 Rearm 构建征召的技能（Torrent 一类）。',
        effect: '为 Rearm 设关卡：只有当 good_with_rearm 技能已被选走或仍在池中时，才会推荐 Rearm。',
    },
    mana_hungry: {
        label: '高耗蓝',
        meaning: '法力需求高（满级法力消耗 150+）。由游戏数据自动推导。',
        effect: '法力预算：两个高耗蓝主动技能就占满任何模型的预算——第三个会被压分。',
    },
    channeled: {
        label: '持续施法',
        meaning: '需要持续施法；会被硬控打断。由游戏数据自动推导。',
        effect: '暂不影响评分——它的价值取决于敌方征召（控制密度），而推荐目前不评估敌方。',
    },
};

export const HERO_TAG_DOCS_ZH: Record<string, TagDoc> = {
    rc_talents: {
        label: '普攻天赋',
        meaning: '与任何技能组都兼容的通用攻击天赋（攻速、攻击力、暴击、射程）。',
        effect: '1–2 号位的模型适配加成；强化与攻击强化/发育手段技能的搭配。',
    },
    caster_talents: {
        label: '法系天赋',
        meaning: '通用法术天赋（冷却、技能增强、施法距离、法力、智力）。',
        effect: '2、4、5 号位的模型适配加成。',
    },
    tank_talents: {
        label: '坦克天赋',
        meaning: '通用生存天赋（生命、护甲、状态抗性、恢复、力量）。',
        effect: '3 号位的模型适配加成。',
    },
    utility_talents: {
        label: '功能天赋',
        meaning: '通用团队/机动天赋（移速、金钱/经验、视野、负面效果持续时间）。',
        effect: '4–5 号位的模型适配加成。',
    },
    innate_offense: {
        label: '进攻型先天',
        meaning: '先天能力在任何征召下都能提升输出（SF 灵魂、Sniper 距离增伤、Ursa 的 Maul）。',
        effect: '1–2 号位的模型适配加成；强化与普攻类技能的搭配。',
    },
    innate_tank: {
        label: '防御型先天',
        meaning: '先天能力偏防御（Medusa 魔法护盾、Bristleback、Dragon Blood、Flesh Heap）。',
        effect: '3 号位的模型适配加成；强化与先手开团/持续施法技能的搭配。',
    },
    innate_team: {
        label: '团队型先天',
        meaning: '先天能力服务于队友（Luna/Drow 光环、Dazzle 的 Weave、Underlord 的传送增益）。',
        effect: '4–5 号位的模型适配加成。',
    },
};

export const ZH: LabDict = {
    positionLabels: {
        1: '核心',
        2: '中单',
        3: '劣单',
        4: '软辅',
        5: '硬辅',
    },
    loading: '正在加载标签目录…',
    loadFailed: (message) => `标签目录加载失败：${message}`,
    titlePre: '技能',
    titleHighlight: '标签实验室',
    introBeforeLink: '每个技能的功能标签驱动着应用的位置感知推荐（想知道原理？请阅读',
    introLink: '推荐机制详解',
    introAfterLink: '）。发现标签有误？提出修正，并为他人的提案投票——被接受的修改随下一次应用更新发布。',
    datasetMeta: (version, abilities, generated) =>
        `数据集 v${version} · ${abilities} 个技能 · ${generated}`,
    viewsAria: '标签实验室视图',
    viewBrowse: '浏览技能',
    viewModels: '浏览模型',
    viewProposals: '提案',
    viewGuide: '标签指南',
    searchAbilityPlaceholder: '搜索技能或英雄…',
    searchAbilityAria: '搜索技能',
    proposeNewTag: '提议新标签',
    countOf: (shown, total) => `${shown} / ${total}`,
    noTags: '暂无标签',
    pendingPrefix: '投票中：',
    pendingNew: (tag) => `+${tag}（新）`,
    pendingMustClear: 'must: 清除',
    pendingMust: (positions) => `must: ${positions} 号位`,
    pendingAvoidClear: 'avoid: 清除',
    pendingAvoid: (positions) => `avoid: ${positions} 号位`,
    posShort: (p) => `${p}号位`,
    mustChipLabel: (positions) => `must: ${positions} 号位`,
    mustChipTitle: (positions) => `${positions} 的精选必选——应用为该位置保证一个推荐位`,
    avoidChipLabelAll: '永不推荐',
    avoidChipLabel: (positions) => `avoid: ${positions} 号位`,
    avoidChipTitleAll: '精选排除：任何位置都不推荐',
    avoidChipTitle: (positions) => `不向 ${positions} 推荐`,
    modelsIntro:
        '模型标签描述的是你征召到的那具「身体」——它的通用天赋和先天能力——而不是技能。它们决定应用按位置推荐哪些模型，以及技能如何与你已选的模型搭配。必选标记的是应用应当始终向某个位置推荐的模型。',
    searchHeroPlaceholder: '搜索英雄…',
    searchHeroAria: '搜索英雄模型',
    heroComposerTitle: (name) => `提议模型标签：${name}`,
    heroComposerIntro:
        '勾选这个模型应当拥有的标签。模型标签描述身体——通用天赋和先天能力——绝不包括它的技能（技能会被征召走）。',
    abilityComposerTitle: (name) => `提议标签：${name}`,
    abilityComposerIntro:
        '勾选这个技能应当拥有的标签。标签是应用会给出的建议（「补足你缺少的清线」）——只有当这条建议正确时才保留它。',
    alreadyProposed: '已有提案（请投票，不要重复提交）：',
    verdictHeadingMust: '必选',
    verdictHeadingSep: ' / ',
    verdictHeadingAvoid: '永不推荐',
    verdictHeadingPositions: ' 号位',
    cycleHintAbility: {
        before: '点击号位循环切换：中立 → ',
        must: 'must',
        afterMust: '（无视统计，永远在该位置推荐）→ ',
        avoid: 'avoid',
        afterAvoid:
            '（永不在该位置推荐；全部五个 = 任何位置都不推荐）。两者都会推翻统计——请只用于明确的情况，并保持列表精简。',
    },
    cycleHintModel: {
        before: '点击号位循环切换：中立 → ',
        must: 'must',
        afterMust: '（永远在该位置推荐）→ ',
        avoid: 'avoid',
        afterAvoid:
            '（不在该位置推荐——当每个队友都已选定模型后，应用会解除模型的 avoid，后手辅助仍可抢走它不让敌方拿到）。两者都会推翻统计——请保持列表精简。',
    },
    proposingRemoveMust: '提议：移除必选精选 ',
    proposingMust: (positions) => `提议：${positions} 号位必选 `,
    proposingRemoveAvoid: '提议：移除「永不推荐」精选',
    proposingAvoid: (positions) => `提议：${positions} 号位不推荐`,
    rationaleRequiredPlaceholder: '为什么给出这个裁定？必填——它会推翻统计。',
    rationaleOptionalPlaceholder: '原因？（选填——充分的理由有助于投票和审核）',
    rationaleNeeded: (min) =>
        `必选 / 永不推荐提案需要理由（至少 ${min} 个字符）——它们推翻统计，就必须自证。`,
    cancel: '取消',
    submitting: '正在提交…',
    submitProposal: '提交提案',
    submittedTitle: '提案已提交',
    submittedBody: '谢谢！它已开放投票。',
    notSubmittedTitle: '未提交',
    newTagComposerTitle: '提议新标签',
    newTagIntro: (min) =>
        `新标签必须物有所值：至少为 ${min} 个技能指定它，并解释它为何必要、推荐可以如何使用它。`,
    newTagNamePlaceholder: 'tag_name（小写字母与下划线）',
    newTagWhyPlaceholder: '为什么需要这个标签？现有标签缺了什么？',
    newTagUsagePlaceholder: '推荐应如何使用它？（例如「当队伍缺少 X 时为 5 号位加分」）',
    newTagAssignPlaceholder: (current, min) => `添加获得此标签的技能（${current}/${min} 起）…`,
    removeTitle: '移除',
    submitNewTag: '提交新标签',
    newTagSubmittedTitle: '新标签已提议',
    newTagSubmittedBody: '它已开放投票。',
    voteFailedTitle: '投票失败',
    proposalsEmptyBefore:
        '还没有提案——来做第一个：在「浏览技能」中选择任意技能。（本地运行需要启动 mock API：',
    proposalsEmptyAfter: '。）',
    modelSuffix: '（模型）',
    removeMustPick: '移除必选',
    mustPickFor: (positions) => `${positions} 号位必选`,
    removeNeverSuggest: '移除「永不推荐」',
    neverSuggestFor: (positions) => `${positions} 号位不推荐`,
    neverSuggestAtAll: '任何位置都不推荐',
    newTagLabel: '新标签',
    abilitiesCount: (n) => `（${n} 个技能）`,
    statusLabel: (status) => (status === 'accepted' ? '已接受' : status === 'rejected' ? '已拒绝' : status),
    suggestedUse: '建议用法：',
    guideIntro1:
        '标签通过三种方式驱动应用的位置感知推荐：各号位的需求清单（「5 号位想要硬控、清线、救援」）、小幅的位置侧重，以及针对你英雄模型的硬过滤。标签是应用会说出口的建议——只有当建议正确时它才应该存在。',
    guideIntro2BeforeMust: '在标签之外，技能还可以携带位置裁定：',
    guideIntro2Must: '必选',
    guideIntro2BetweenMustAvoid: '（即使统计不同意，也始终推荐给该位置的征召者）和',
    guideIntro2Avoid: '永不推荐',
    guideIntro2After:
        '（在该位置从推荐中排除——全部五个号位即任何位置都不推荐，留给那些明摆着的差选择）。标签是技能做什么的事实；裁定是谁需要它的判断——在「浏览技能」中打开任意技能的对话框即可提议，需附理由。',
    guideAbilities: (n) => `${n} 个技能`,
    guideHeroes: (n) => `${n} 个英雄`,
    guideCommunityTag: '社区标签——推荐尚未使用它。',
    guideModelTagsHeading: '模型标签',
    guideModelTagsIntro:
        '英雄模型有自己的标签：身体的通用天赋和先天能力——技能会被征召走，所以强化特定技能的天赋毫无价值。模型标签决定按位置的模型推荐，以及已征召技能与所选模型的搭配。',
    tagDocs: TAG_DOCS_ZH,
    heroTagDocs: HERO_TAG_DOCS_ZH,
};
