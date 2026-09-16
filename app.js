/* =====================================================================
   Simulador da Reforma Tributária — Lucro Real · Contabiliza
   (cara comercial: textos de apresentação; motor de cálculo intacto)
   ---------------------------------------------------------------------
   Ferramenta consultiva. NÃO é apurador de Lucro Real, ECF, ECD ou LALUR.
   IRPJ, CSLL e encargos entram como MÉDIAS HISTÓRICAS informadas.

   REGRA DE ARQUITETURA: nenhuma alíquota da Reforma (IBS, CBS, IS) nem
   percentual de transição de ICMS/ISS/IPI pode ser escrito fora de
   FISCAL_RULES. O motor lê tudo daqui.
   ===================================================================== */
(function(){
'use strict';

var DATA_BASE = '2026-08-19';

/* formatador de moeda pt-BR — usado pelo motor (mensagens) e pela interface */
var BRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2});

/* ---------- fontes normativas registradas (metadados, sem transcrição) ---------- */
var FONTES = {
  EC132:    { id:'EC132',    rotulo:'EC 132/2023',                 desc:'Emenda Constitucional da Reforma Tributária sobre o consumo. Base da imunidade das exportações com manutenção dos créditos.' },
  LC214:    { id:'LC214',    rotulo:'LC 214/2025',                 desc:'Lei Complementar que institui o IBS, a CBS e o Imposto Seletivo. Arts. 47 a 53 e regras de exportação: apropriação e utilização de créditos, alíquota reduzida, alíquota zero, isenção e imunidade.' },
  LC227:    { id:'LC227',    rotulo:'LC 227/2026',                 desc:'Lei Complementar de ajustes ao regime do IBS/CBS, na parte aplicável à redação vigente das regras de creditamento.' },
  DEC12955: { id:'DEC12955', rotulo:'Decreto 12.955/2026',         desc:'Regulamentação da CBS, especialmente as regras gerais de creditamento e o tratamento dos créditos nas operações com alíquota reduzida, alíquota zero, isenção, imunidade e exportação.' },
  RES6:     { id:'RES6',     rotulo:'Resolução CGIBS nº 6/2026',   desc:'Regulamentação do IBS, com as regras equivalentes de creditamento e de tratamento dos créditos nas saídas beneficiadas.' },
  RES14:    { id:'RES14',    rotulo:'Resolução CGIBS nº 14, de 29/07/2026', desc:'Estimativa utilizada para o IBS e para a alíquota-padrão conjunta.' },
  SN_IBSCBS:{ id:'SN_IBSCBS',rotulo:'Regulamentação do Simples Nacional aplicável ao IBS/CBS',
              desc:'Regras aplicáveis ao crédito de IBS/CBS nas aquisições de fornecedor optante pelo Simples Nacional: o crédito do adquirente sujeito ao regime regular corresponde ao IBS/CBS devido pelo fornecedor optante pelo Simples, não sendo presumido como fração da alíquota-padrão do regime regular. Não autoriza presumir alíquota genérica de crédito.' }
};

/* ---------- estados semânticos das premissas ---------- */
var STATUS = {
  LEGAL_FIXED:       { chave:'LEGAL_FIXED',       rotulo:'Definido em norma',   desc:'Percentual fixado em norma vigente.' },
  OFFICIAL_ESTIMATE: { chave:'OFFICIAL_ESTIMATE', rotulo:'Estimativa atual',    desc:'Estimativa oficial divulgada. Não é alíquota definitiva.' },
  DERIVED_ESTIMATE:  { chave:'DERIVED_ESTIMATE',  rotulo:'Estimativa atual',    desc:'Valor derivado por diferença a partir de outra estimativa oficial. Não é alíquota definitiva.' },
  PROJECTED:         { chave:'PROJECTED',         rotulo:'Projeção',            desc:'Projeção de cenário construída para a simulação. Não é alíquota definitiva.' },
  USER_CUSTOM:       { chave:'USER_CUSTOM',       rotulo:'Personalizado',       desc:'Valor alterado pelo usuário nesta simulação.' },
  PENDING_LAW:       { chave:'PENDING_LAW',       rotulo:'Pendente de lei',     desc:'Percentual ainda não definido em norma. O simulador não presume valor.' },
  USER_INPUT:        { chave:'USER_INPUT',        rotulo:'Informado por você',  desc:'Dado operacional informado pelo usuário.' },
  HISTORICAL:        { chave:'HISTORICAL',        rotulo:'Média histórica',     desc:'Média histórica informada pelo usuário e mantida sem recálculo.' },
  USER_REQUIRED:     { chave:'USER_REQUIRED',     rotulo:'Sem premissa cadastrada', desc:'O conjunto Contabiliza não traz percentual validado para este campo. O simulador não presume valor: informe a alíquota da empresa.' },
  USER_RATE:         { chave:'USER_RATE',         rotulo:'Calculado por alíquota',  desc:'Valor obtido por base × alíquota informadas pelo usuário nesta simulação.' }
};

/** cria uma premissa com toda a rastreabilidade exigida pelo produto */
function premissa(valor, status, o){
  o = o || {};
  return {
    valor: valor,
    ano: o.ano != null ? o.ano : null,
    status: status,
    descricao: o.descricao || '',
    fonte: o.fonte || null,
    dataBase: o.dataBase || DATA_BASE,
    editavel: o.editavel !== false
  };
}

/* =====================================================================
   FISCAL_RULES — conjunto oficial Contabiliza, data-base 2026-08-19
   ===================================================================== */
var FISCAL_RULES_PADRAO = {
  meta: {
    produto: 'Veja o impacto da Reforma — Lucro Real',
    versao: '1.0.0',
    dataBase: DATA_BASE,
    // revisão específica do módulo de compras/créditos; NÃO altera a data-base das estimativas de alíquota
    purchaseRulesReviewedAt: '2026-08-20',
    anos: [2027,2028,2029,2030,2031,2032,2033],
    observacao: 'Premissas Contabiliza. Estimativas e projeções não são alíquotas definitivas.'
  },

  fontes: FONTES,

  /* ---- estimativa de longo prazo (regime pleno) ---- */
  longoPrazo: {
    aliquotaPadraoConjunta: premissa(27.91, 'OFFICIAL_ESTIMATE', {
      descricao:'Alíquota-padrão conjunta estimada de IBS + CBS no regime pleno.',
      fonte:'RES14'
    }),
    ibsCheio: premissa(18.70, 'OFFICIAL_ESTIMATE', {
      descricao:'Parcela estimada do IBS na alíquota-padrão conjunta.',
      fonte:'RES14'
    }),
    cbsCheia: premissa(9.21, 'DERIVED_ESTIMATE', {
      descricao:'CBS cheia utilizada para cenário, obtida por diferença: 27,91 - 18,70 = 9,21. Não é alíquota definitiva.',
      fonte:'RES14'
    })
  },

  /* ---- premissas ano a ano da transição ----
     ibs / cbs .................. alíquotas aplicadas sobre a receita tributável do ano
     icmsRemanescente ........... % do ICMS atual informado que permanece devido
     issRemanescente ............ % do ISS atual informado que permanece devido
     pisCofins .................. 'EXTINTO' => sai do cenário Reforma
     ipiPadrao .................. % do IPI atual mantido por padrão (residual/ZFM é opção manual)  */
  anos: {
    2027: {
      ibs: premissa(0.10, 'LEGAL_FIXED', { ano:2027, descricao:'IBS de teste em 2027.', fonte:'EC132' }),
      cbs: premissa(9.11, 'PROJECTED',   { ano:2027, descricao:'CBS de cenário: estimativa de 9,21% menos a redução de 0,1 p.p. prevista para 2027/2028. Projeção, não valor definitivo.', fonte:'LC214' }),
      icmsRemanescente: premissa(100, 'LEGAL_FIXED', { ano:2027, descricao:'ICMS integralmente mantido em 2027.', fonte:'EC132' }),
      issRemanescente:  premissa(100, 'LEGAL_FIXED', { ano:2027, descricao:'ISS integralmente mantido em 2027.',  fonte:'EC132' }),
      pisCofins: 'EXTINTO',
      ipiPadrao: premissa(0, 'LEGAL_FIXED', { ano:2027, descricao:'IPI zerado por padrão a partir de 2027, salvo hipótese residual/ZFM habilitada manualmente.', fonte:'EC132' })
    },
    2028: {
      ibs: premissa(0.10, 'LEGAL_FIXED', { ano:2028, descricao:'IBS de teste em 2028.', fonte:'EC132' }),
      cbs: premissa(9.11, 'PROJECTED',   { ano:2028, descricao:'CBS de cenário: estimativa de 9,21% menos a redução de 0,1 p.p. prevista para 2027/2028. Projeção, não valor definitivo.', fonte:'LC214' }),
      icmsRemanescente: premissa(100, 'LEGAL_FIXED', { ano:2028, descricao:'ICMS integralmente mantido em 2028.', fonte:'EC132' }),
      issRemanescente:  premissa(100, 'LEGAL_FIXED', { ano:2028, descricao:'ISS integralmente mantido em 2028.',  fonte:'EC132' }),
      pisCofins: 'EXTINTO',
      ipiPadrao: premissa(0, 'LEGAL_FIXED', { ano:2028, descricao:'IPI zerado por padrão, salvo hipótese residual/ZFM.', fonte:'EC132' })
    },
    2029: {
      ibs: premissa(1.87, 'PROJECTED', { ano:2029, descricao:'IBS projetado equivalente a 10% da estimativa cheia de 18,70%.', fonte:'RES14' }),
      cbs: premissa(9.21, 'PROJECTED', { ano:2029, descricao:'CBS de cenário conforme estimativa derivada de 9,21%.', fonte:'RES14' }),
      icmsRemanescente: premissa(90, 'LEGAL_FIXED', { ano:2029, descricao:'ICMS reduzido a 90% na transição.', fonte:'EC132' }),
      issRemanescente:  premissa(90, 'LEGAL_FIXED', { ano:2029, descricao:'ISS reduzido a 90% na transição.',  fonte:'EC132' }),
      pisCofins: 'EXTINTO',
      ipiPadrao: premissa(0, 'LEGAL_FIXED', { ano:2029, descricao:'IPI zerado por padrão, salvo hipótese residual/ZFM.', fonte:'EC132' })
    },
    2030: {
      ibs: premissa(3.74, 'PROJECTED', { ano:2030, descricao:'IBS projetado equivalente a 20% da estimativa cheia de 18,70%.', fonte:'RES14' }),
      cbs: premissa(9.21, 'PROJECTED', { ano:2030, descricao:'CBS de cenário conforme estimativa derivada de 9,21%.', fonte:'RES14' }),
      icmsRemanescente: premissa(80, 'LEGAL_FIXED', { ano:2030, descricao:'ICMS reduzido a 80% na transição.', fonte:'EC132' }),
      issRemanescente:  premissa(80, 'LEGAL_FIXED', { ano:2030, descricao:'ISS reduzido a 80% na transição.',  fonte:'EC132' }),
      pisCofins: 'EXTINTO',
      ipiPadrao: premissa(0, 'LEGAL_FIXED', { ano:2030, descricao:'IPI zerado por padrão, salvo hipótese residual/ZFM.', fonte:'EC132' })
    },
    2031: {
      ibs: premissa(5.61, 'PROJECTED', { ano:2031, descricao:'IBS projetado equivalente a 30% da estimativa cheia de 18,70%.', fonte:'RES14' }),
      cbs: premissa(9.21, 'PROJECTED', { ano:2031, descricao:'CBS de cenário conforme estimativa derivada de 9,21%.', fonte:'RES14' }),
      icmsRemanescente: premissa(70, 'LEGAL_FIXED', { ano:2031, descricao:'ICMS reduzido a 70% na transição.', fonte:'EC132' }),
      issRemanescente:  premissa(70, 'LEGAL_FIXED', { ano:2031, descricao:'ISS reduzido a 70% na transição.',  fonte:'EC132' }),
      pisCofins: 'EXTINTO',
      ipiPadrao: premissa(0, 'LEGAL_FIXED', { ano:2031, descricao:'IPI zerado por padrão, salvo hipótese residual/ZFM.', fonte:'EC132' })
    },
    2032: {
      ibs: premissa(7.48, 'PROJECTED', { ano:2032, descricao:'IBS projetado equivalente a 40% da estimativa cheia de 18,70%.', fonte:'RES14' }),
      cbs: premissa(9.21, 'PROJECTED', { ano:2032, descricao:'CBS de cenário conforme estimativa derivada de 9,21%.', fonte:'RES14' }),
      icmsRemanescente: premissa(60, 'LEGAL_FIXED', { ano:2032, descricao:'ICMS reduzido a 60% na transição.', fonte:'EC132' }),
      issRemanescente:  premissa(60, 'LEGAL_FIXED', { ano:2032, descricao:'ISS reduzido a 60% na transição.',  fonte:'EC132' }),
      pisCofins: 'EXTINTO',
      ipiPadrao: premissa(0, 'LEGAL_FIXED', { ano:2032, descricao:'IPI zerado por padrão, salvo hipótese residual/ZFM.', fonte:'EC132' })
    },
    2033: {
      ibs: premissa(18.70, 'OFFICIAL_ESTIMATE', { ano:2033, descricao:'IBS cheio estimado no regime pleno.', fonte:'RES14' }),
      cbs: premissa(9.21,  'DERIVED_ESTIMATE',  { ano:2033, descricao:'CBS cheia estimada, obtida por diferença da alíquota-padrão conjunta.', fonte:'RES14' }),
      icmsRemanescente: premissa(0, 'LEGAL_FIXED', { ano:2033, descricao:'ICMS extinto no regime pleno.', fonte:'EC132' }),
      issRemanescente:  premissa(0, 'LEGAL_FIXED', { ano:2033, descricao:'ISS extinto no regime pleno.',  fonte:'EC132' }),
      pisCofins: 'EXTINTO',
      ipiPadrao: premissa(0, 'LEGAL_FIXED', { ano:2033, descricao:'IPI zerado por padrão, salvo hipótese residual/ZFM.', fonte:'EC132' })
    }
  },

  /* ---- Imposto Seletivo ----
     Nenhuma alíquota geral é presumida. Só há cálculo com percentual
     informado explicitamente pelo usuário enquanto o status for PENDING_LAW. */
  impostoSeletivo: {
    habilitadoPadrao: false,
    aliquotaGeral: premissa(null, 'PENDING_LAW', {
      descricao:'Não há alíquota geral de Imposto Seletivo definida em norma para uso automático nesta ferramenta.',
      fonte:'LC214', editavel:true
    }),
    categorias: [
      { id:'veiculos',    rotulo:'Veículos' },
      { id:'embarcacoes', rotulo:'Embarcações e aeronaves' },
      { id:'fumigenos',   rotulo:'Produtos fumígenos' },
      { id:'alcoolicas',  rotulo:'Bebidas alcoólicas' },
      { id:'acucaradas',  rotulo:'Bebidas açucaradas' },
      { id:'minerais',    rotulo:'Bens minerais',
        limiteMaximo: premissa(0.25, 'LEGAL_FIXED', {
          descricao:'Limite legal máximo de 0,25% para bens minerais. O simulador NÃO presume que a alíquota será esse limite.',
          fonte:'EC132', editavel:false }) },
      { id:'prognosticos',rotulo:'Concursos de prognósticos / fantasy sport' },
      { id:'outro',       rotulo:'Outro tratamento previsto' }
    ]
  },

  /* ---- tratamentos de receita para IBS/CBS ----
     fatorAliquota: multiplicador aplicado à ALÍQUOTA do ano (nunca à base).
     Os tipos são enums separados de propósito: alíquota zero, isenção e
     exportação têm efeito idêntico no débito, mas o tratamento de créditos
     é diferente e será distinto quando as regras forem especificadas. */
  /* creditTreatment — intenção fiscal explícita sobre os créditos DAS AQUISIÇÕES
     de quem realiza a saída. Nunca inferir pelo nome do enum.
       MAINTAIN ............... a saída não anula os créditos anteriores
       PROPORTIONAL_REVERSAL .. a saída exige anulação proporcional dos créditos */
  tratamentosReceita: [
    { id:'INTEGRAL',   rotulo:'Tributação integral',        fatorAliquota:1.00, geraDebito:true,  pctEditavel:false,
      creditos:'INTEGRAL',   creditTreatment:'MAINTAIN', fonte:'LC214',
      ajuda:'Receita tributada pela alíquota cheia do ano.' },
    { id:'RED_30',     rotulo:'Redução de 30%',             fatorAliquota:0.70, geraDebito:true,  pctEditavel:false,
      creditos:'REDUZIDO',   creditTreatment:'MAINTAIN', fonte:'LC214',
      ajuda:'Paga 70% da alíquota do ano. A alíquota reduzida não acarreta estorno dos créditos das aquisições, salvo previsão expressa específica.' },
    { id:'RED_60',     rotulo:'Redução de 60%',             fatorAliquota:0.40, geraDebito:true,  pctEditavel:false,
      creditos:'REDUZIDO',   creditTreatment:'MAINTAIN', fonte:'LC214',
      ajuda:'Paga 40% da alíquota do ano. A alíquota reduzida não acarreta estorno dos créditos das aquisições, salvo previsão expressa específica.' },
    { id:'ALIQ_ZERO',  rotulo:'Alíquota zero',              fatorAliquota:0.00, geraDebito:true,  pctEditavel:false,
      creditos:'ALIQ_ZERO',  creditTreatment:'MAINTAIN', fonte:'LC214',
      ajuda:'Débito zero na saída. Mantém os créditos relativos às operações anteriores, salvo hipótese legal específica em contrário.' },
    { id:'ISENCAO',    rotulo:'Isenção',                    fatorAliquota:0.00, geraDebito:false, pctEditavel:false,
      creditos:'ISENCAO',    creditTreatment:'PROPORTIONAL_REVERSAL', fonte:'LC214',
      ajuda:'Débito zero na saída. Em regra acarreta anulação proporcional dos créditos relativos às operações anteriores.' },
    { id:'EXPORTACAO', rotulo:'Exportação',                 fatorAliquota:0.00, geraDebito:false, pctEditavel:false,
      creditos:'EXPORTACAO', creditTreatment:'MAINTAIN', fonte:'EC132',
      ajuda:'Imune ao IBS/CBS, porém assegura ao exportador a apropriação e a utilização dos créditos permitidos. Não entra na proporção de estorno.' },
    { id:'IMUNIDADE',  rotulo:'Imunidade — outras hipóteses', fatorAliquota:0.00, geraDebito:false, pctEditavel:false,
      creditos:'IMUNIDADE',  creditTreatment:'PROPORTIONAL_REVERSAL', fonte:'EC132',
      ajuda:'Existem hipóteses legais específicas de imunidade com tratamento próprio de créditos. Esta opção representa a regra geral e não deve ser usada para exportações.' },
    { id:'RED_CUSTOM', rotulo:'Redução personalizada',      fatorAliquota:null, geraDebito:true,  pctEditavel:true,
      creditos:'REDUZIDO',   creditTreatment:'MAINTAIN', fonte:null,
      ajuda:'Percentual de redução definido por você. A alíquota reduzida não acarreta estorno dos créditos das aquisições, salvo previsão expressa específica.' }
  ],

  /* ---- tratamento de créditos de compras (estrutura preparada) ---- */
  tratamentosCredito: [
    { id:'INTEGRAL',   rotulo:'Crédito integral',        fatorCredito:1.00, editavel:false },
    { id:'PARCIAL',    rotulo:'Crédito parcial',         fatorCredito:null, editavel:true  },
    { id:'SEM_CREDITO',rotulo:'Sem direito a crédito',   fatorCredito:0.00, editavel:false }
  ],

  /* ---- modo de apuração do crédito das compras ----
       SIMPLE ..... compras × percentual creditável × alíquota do ano (padrão)
       DETAILED ... exclusivamente pelos grupos de aquisição informados

     Regra de cálculo de cada grupo (sempre separada por tributo). Há DOIS
     modelos distintos, e não se deve confundi-los:

     a) modelo por FATOR sobre a alíquota do ano (REGULAR_*, NO_CREDIT,
        PRESUMED_MANUAL):
          creditoIBS = base × IBS do ano × fator
          creditoCBS = base × CBS do ano × fator

     b) modelo por ALÍQUOTA EFETIVA DE CRÉDITO (SIMPLES):
          creditoIBS = base × aliquotaCreditoIbs / 100
          creditoCBS = base × aliquotaCreditoCbs / 100
        Aqui NÃO se multiplica pela alíquota do ano nem por 27,91 / 18,70 /
        9,21. O crédito do adquirente do regime regular corresponde ao IBS/CBS
        efetivamente devido pelo fornecedor por meio do Simples Nacional, e não
        a uma fração da alíquota-padrão do regime regular.

     RASTREABILIDADE: a escolha do tipo é sempre uma CLASSIFICAÇÃO feita pelo
     usuário (classificationStatus = USER_INPUT). O que pode ser definido em
     norma é a REGRA DE CÁLCULO aplicada (ruleStatus).

     IMPORTANTE: nenhum percentual de crédito é presumido pelo simulador. Os
     campos manuais nascem vazios. */
  compras: {
    modoPadrao: 'SIMPLE',
    modos: [
      { id:'SIMPLE',   rotulo:'Estimativa simplificada' },
      { id:'DETAILED', rotulo:'Detalhado por grupo de aquisição' }
    ],
    /* fatorFixo ............... multiplicador da alíquota do ano (modelo "a")
       pedeReducao ............. abre campo de redução da alíquota na aquisição
       pedeFatores ............. abre fatores sobre a alíquota do ano (modelo "a")
       pedeAliquotasCredito .... abre alíquotas efetivas de crédito (modelo "b")
       classificationStatus .... origem da classificação da linha
       ruleStatus .............. origem da regra de cálculo aplicada */
    tipos: [
      { id:'REGULAR_FULL',    rotulo:'Regime regular — tributação padrão',
        fatorFixo:1.00, pedeReducao:false, pedeFatores:false, pedeAliquotasCredito:false,
        classificationStatus:'USER_INPUT', ruleStatus:'LEGAL_FIXED', ruleRotulo:'Regra: definida em norma', fonte:'LC214',
        ajuda:'Aquisição tributada pela alíquota padrão do ano. O crédito acompanha o IBS/CBS incidente na operação.' },
      { id:'REGULAR_REDUCED', rotulo:'Regime regular — tributação reduzida',
        fatorFixo:null, pedeReducao:true,  pedeFatores:false, pedeAliquotasCredito:false,
        classificationStatus:'USER_INPUT', ruleStatus:'USER_CUSTOM', ruleRotulo:'Redução informada: personalizada', fonte:'LC214',
        ajuda:'Informe a redução da alíquota na aquisição. O adquirente toma crédito apenas sobre o IBS/CBS efetivamente incidente, e não pela alíquota cheia.' },
      { id:'NO_CREDIT',       rotulo:'Aquisição sem crédito',
        fatorFixo:0.00, pedeReducao:false, pedeFatores:false, pedeAliquotasCredito:false,
        classificationStatus:'USER_INPUT', ruleStatus:'LEGAL_FIXED', ruleRotulo:'Regra: definida em norma', fonte:'LC214',
        ajuda:'Use para aquisições que, conforme o tratamento aplicável, não geram crédito ao adquirente. Também serve para aquisições isentas, imunes ou com alíquota zero, nas quais não há tributo apropriável, ressalvados créditos presumidos previstos expressamente.' },
      { id:'SIMPLES',         rotulo:'Fornecedor optante pelo Simples Nacional',
        fatorFixo:null, pedeReducao:false, pedeFatores:false, pedeAliquotasCredito:true,
        classificationStatus:'USER_INPUT', ruleStatus:'USER_CUSTOM', ruleRotulo:'Alíquotas efetivas: personalizadas', fonte:'SN_IBSCBS',
        ajuda:'Informe a alíquota efetiva de crédito correspondente ao IBS/CBS devido pelo fornecedor do Simples Nacional nesta aquisição ou grupo de aquisições. O simulador não calcula DAS, anexo, RBT12 nem presume percentual.' },
      { id:'PRESUMED_MANUAL', rotulo:'Crédito presumido — premissa personalizada',
        fatorFixo:null, pedeReducao:false, pedeFatores:true,  pedeAliquotasCredito:false,
        classificationStatus:'USER_INPUT', ruleStatus:'USER_CUSTOM', ruleRotulo:'Premissa: personalizada', fonte:'LC214',
        ajuda:'Existem hipóteses legais específicas de crédito presumido, como produtor rural não contribuinte, transportador autônomo, resíduos destinados à reciclagem e bens móveis usados para revenda. Esta versão não identifica automaticamente qual hipótese se aplica.' }
    ]
  },

  /* ---- tributos atuais informados pelo usuário ----
     Dois modos de entrada por tributo:
       VALUE .... média mensal efetivamente recolhida (padrão, sempre)
       RATE ..... estimativa por base × alíquota informadas pelo usuário
     As alíquotas abaixo NÃO possuem premissa Contabiliza validada no conjunto
     atual (data-base 2026-08-19). Por isso ficam com valor nulo e status
     USER_REQUIRED: nenhum percentual é presumido pelo simulador.
     TODO_FISCAL_VALIDATION: caso venham a ser cadastradas premissas validadas
     de PIS, Cofins, ICMS, ISS ou IPI, basta preencher "valor" e ajustar o
     status aqui — o motor e a interface leem exclusivamente deste bloco. */
  tributosAtuais: {
    modoPadrao: 'VALUE',
    modos: [
      { id:'VALUE', rotulo:'Média histórica informada',        origemStatus:'HISTORICAL' },
      { id:'RATE',  rotulo:'Calculado pelo usuário por alíquota', origemStatus:'USER_RATE' }
    ],
    aliquotas: {
      pis:    premissa(null, 'USER_REQUIRED', { descricao:'Alíquota de PIS aplicada sobre a base informada. Sem premissa validada no conjunto atual.',    fonte:null, editavel:true }),
      cofins: premissa(null, 'USER_REQUIRED', { descricao:'Alíquota de Cofins aplicada sobre a base informada. Sem premissa validada no conjunto atual.', fonte:null, editavel:true }),
      icms:   premissa(null, 'USER_REQUIRED', { descricao:'Alíquota efetiva de ICMS utilizada na simulação. Não é a alíquota nominal e não há premissa validada no conjunto atual.', fonte:null, editavel:true }),
      iss:    premissa(null, 'USER_REQUIRED', { descricao:'Alíquota efetiva de ISS utilizada na simulação. Sem premissa validada no conjunto atual.',     fonte:null, editavel:true }),
      ipi:    premissa(null, 'USER_REQUIRED', { descricao:'Alíquota efetiva de IPI utilizada na simulação. Sem premissa validada no conjunto atual. Esta versão não identifica NCM nem TIPI.', fonte:null, editavel:true })
    }
  },

  segmentos: [
    { id:'comercio',  rotulo:'Comércio',  tributos:['pisCofins','icms'] },
    { id:'industria', rotulo:'Indústria', tributos:['pisCofins','icms','ipi'] },
    { id:'servicos',  rotulo:'Serviços',  tributos:['pisCofins','iss'] },
    { id:'transporte',rotulo:'Transporte',tributos:['pisCofins','icms','iss'] }
  ]
};

/* cópia de trabalho: recebe as edições do usuário sem perder o padrão */
var FISCAL_RULES = clonar(FISCAL_RULES_PADRAO);

function clonar(o){ return JSON.parse(JSON.stringify(o)); }

/* =====================================================================
   MOTOR DE CÁLCULO — funções puras, sem qualquer acesso ao DOM
   ---------------------------------------------------------------------
   Entrada padrão (objeto P), todos os valores em R$/mês:
   {
     faturamento, compras, pctCreditavel, pctB2B, pctExportacao,
     atual: {pisCofins, icms, iss, ipi},
     complementar: {irpjCsll, encargosPatronais, encargosProLabore},
     receitasEspeciais: [{descricao, valor, tratamento, pctCustom}],
     impostoSeletivo: {sujeita, categoria, base, usarCustom, aliquota},
     ipiResidual: {ativo, valor},
     reducaoGeral
   }
   ===================================================================== */

function num(v){ var n = parseFloat(v); return isFinite(n) ? n : 0; }
function naoNegativo(v){ var n = num(v); return n < 0 ? 0 : n; }

/** regras do ano, já com as edições do usuário aplicadas */
function regrasDoAno(regras, ano){
  var r = regras.anos[ano];
  if(!r) throw new Error('Ano fora da transição configurada: ' + ano);
  return r;
}

/* ---------------------------------------------------------------------
   NORMALIZAÇÃO DA ENTRADA DOS TRIBUTOS ATUAIS
   O motor da Reforma não sabe de onde veio o tributo atual. Estas funções
   convertem qualquer modo de entrada em R$/mês antes do cálculo.
   --------------------------------------------------------------------- */

/** resolve uma entrada de tributo atual para valor mensal em reais.
    entrada = { modo:'VALUE'|'RATE', valor, base, aliquota }
    Retorna também a rastreabilidade da origem do número. */
function resolveCurrentTaxInput(entrada){
  entrada = entrada || {};
  var modo = entrada.modo === 'RATE' ? 'RATE' : 'VALUE';
  if(modo === 'RATE'){
    var base = naoNegativo(entrada.base);
    var aliq = Math.max(0, num(entrada.aliquota));
    return {
      modo:'RATE', valor: base * aliq / 100, base: base, aliquota: aliq,
      origemStatus:'USER_RATE', origem:'Calculado pelo usuário por alíquota'
    };
  }
  return {
    modo:'VALUE', valor: naoNegativo(entrada.valor), base:null, aliquota:null,
    origemStatus:'HISTORICAL', origem:'Média histórica informada'
  };
}

/** normaliza o conjunto de tributos atuais.
    PIS e Cofins são informados juntos no modo VALUE e separados no modo RATE. */
function normalizeCurrentTaxes(entradas){
  entradas = entradas || {};
  var pc = entradas.pisCofins || {};
  var det = {}, valores = {};

  if(pc.modo === 'RATE'){
    var pis = resolveCurrentTaxInput({ modo:'RATE', base:(pc.pis||{}).base, aliquota:(pc.pis||{}).aliquota });
    var cof = resolveCurrentTaxInput({ modo:'RATE', base:(pc.cofins||{}).base, aliquota:(pc.cofins||{}).aliquota });
    valores.pisCofins = pis.valor + cof.valor;
    det.pisCofins = { modo:'RATE', valor:valores.pisCofins, pis:pis, cofins:cof,
                      origemStatus:'USER_RATE', origem:'Calculado pelo usuário por alíquota' };
  } else {
    var v = resolveCurrentTaxInput({ modo:'VALUE', valor:pc.valor });
    valores.pisCofins = v.valor;
    det.pisCofins = { modo:'VALUE', valor:v.valor, pis:null, cofins:null,
                      origemStatus:v.origemStatus, origem:v.origem };
  }

  ['icms','iss','ipi'].forEach(function(k){
    var r = resolveCurrentTaxInput(entradas[k]);
    valores[k] = r.valor;
    det[k] = r;
  });

  return { valores: valores, detalhe: det };
}

/* ---------------------------------------------------------------------
   VALIDAÇÃO DA CLASSIFICAÇÃO DE RECEITA (fail closed)
   Se a receita classificada superar o faturamento, o cenário é inválido:
   nada é cortado, rateado ou corrigido silenciosamente.
   --------------------------------------------------------------------- */
function validateRevenueClassification(P){
  var faturamento = naoNegativo(P.faturamento);
  var pctExp = Math.min(100, Math.max(0, num(P.pctExportacao)));
  var exportacaoModoSimples = faturamento * pctExp / 100;
  var somaReceitasEspeciais = (P.receitasEspeciais || []).reduce(function(s,l){
    return s + naoNegativo(l.valor);
  }, 0);
  var receitaClassificada = exportacaoModoSimples + somaReceitasEspeciais;
  var excesso = receitaClassificada - faturamento;
  var valido = excesso <= 0.005;

  // duplicidade possível: exportação informada nos dois lugares ao mesmo tempo
  var linhasExportacao = (P.receitasEspeciais || []).filter(function(l){
    return l.tratamento === 'EXPORTACAO' && naoNegativo(l.valor) > 0;
  });
  var possivelDuplicidadeExportacao = exportacaoModoSimples > 0 && linhasExportacao.length > 0;

  return {
    valido: valido,
    faturamento: faturamento,
    exportacaoModoSimples: exportacaoModoSimples,
    somaReceitasEspeciais: somaReceitasEspeciais,
    receitaClassificada: receitaClassificada,
    excesso: valido ? 0 : excesso,
    possivelDuplicidadeExportacao: possivelDuplicidadeExportacao,
    linhasExportacao: linhasExportacao.length,
    mensagem: valido ? '' :
      'As receitas classificadas excedem o faturamento em ' +
      BRL.format(excesso) +
      '. Revise exportações e tratamentos específicos antes de simular.'
  };
}

/** A · carga atual de tributos sobre consumo, a partir das médias informadas */
function calculateCurrentConsumptionTaxes(P){
  var pisCofins = naoNegativo(P.atual.pisCofins);
  var icms      = naoNegativo(P.atual.icms);
  var iss       = naoNegativo(P.atual.iss);
  var ipi       = naoNegativo(P.atual.ipi);
  return {
    pisCofins: pisCofins, icms: icms, iss: iss, ipi: ipi,
    total: pisCofins + icms + iss + ipi
  };
}

/** separa o faturamento por tratamento de IBS/CBS.
    A redução incide sobre a ALÍQUOTA: cada linha carrega um fatorAliquota. */
function calculateRevenueTreatment(P, regras){
  var faturamento = naoNegativo(P.faturamento);
  var mapa = {}; regras.tratamentosReceita.forEach(function(t){ mapa[t.id] = t; });

  var linhas = [];

  // exportação informada no modo simples vira uma linha própria
  var pctExp = Math.min(100, Math.max(0, num(P.pctExportacao)));
  var valorExp = faturamento * pctExp / 100;
  if(valorExp > 0){
    linhas.push({
      descricao: 'Exportações (' + pctExp.toLocaleString('pt-BR',{maximumFractionDigits:2}) + '% do faturamento)',
      valor: valorExp, tratamento: 'EXPORTACAO', fatorAliquota: 0,
      geraDebito: false, creditos: mapa.EXPORTACAO.creditos, origem: 'campo de exportações'
    });
  }

  // linhas informadas na seção de tratamentos específicos
  (P.receitasEspeciais || []).forEach(function(l){
    var t = mapa[l.tratamento] || mapa.INTEGRAL;
    var fator;
    if(t.pctEditavel){
      var pct = Math.min(100, Math.max(0, num(l.pctCustom)));
      fator = 1 - pct/100;
    } else {
      fator = t.fatorAliquota;
    }
    var valor = naoNegativo(l.valor);
    if(valor <= 0) return;
    linhas.push({
      descricao: l.descricao || t.rotulo,
      valor: valor, tratamento: t.id, fatorAliquota: fator,
      geraDebito: t.geraDebito, creditos: t.creditos,
      pctCustom: t.pctEditavel ? num(l.pctCustom) : null,
      origem: 'linha informada'
    });
  });

  var informado = linhas.reduce(function(s,l){ return s + l.valor; }, 0);
  var excedente = informado > faturamento ? informado - faturamento : 0;
  var residual  = Math.max(0, faturamento - informado);

  // o restante do faturamento é tributação integral, com a redução geral
  // opcional das premissas avançadas aplicada sobre a alíquota
  var redGeral = Math.min(100, Math.max(0, num(P.reducaoGeral)));
  if(residual > 0){
    linhas.unshift({
      descricao: redGeral > 0
        ? 'Receita integral com redução geral de ' + redGeral.toLocaleString('pt-BR',{maximumFractionDigits:2}) + '% da alíquota'
        : 'Receita com tributação integral',
      valor: residual, tratamento: 'INTEGRAL', fatorAliquota: 1 - redGeral/100,
      geraDebito: true, creditos: mapa.INTEGRAL.creditos, origem: 'residual do faturamento'
    });
  }

  // base efetiva = soma de (valor x fator). É o que a alíquota do ano multiplica.
  var baseEfetiva = linhas.reduce(function(s,l){ return s + l.valor * l.fatorAliquota; }, 0);

  return {
    faturamento: faturamento,
    linhas: linhas,
    baseEfetiva: baseEfetiva,
    totalInformado: informado,
    residualIntegral: residual,
    excedente: excedente,
    reducaoGeral: redGeral
  };
}

/** débito de IBS e CBS do ano sobre a base efetiva */
function calculateIbsCbsDebit(tratamento, aliqIbs, aliqCbs){
  var base = naoNegativo(tratamento.baseEfetiva);
  return {
    base: base,
    aliqIbs: num(aliqIbs), aliqCbs: num(aliqCbs),
    ibs: base * num(aliqIbs) / 100,
    cbs: base * num(aliqCbs) / 100,
    get total(){ return this.ibs + this.cbs; }
  };
}

/* =====================================================================
   CRÉDITOS — DUAS REGRAS QUE NÃO PODEM SER CONFUNDIDAS
   ---------------------------------------------------------------------
   1) Crédito de quem REALIZA uma saída beneficiada.
      É o que este bloco trata. A saída beneficiada pode ou não obrigar a
      anular os créditos que a empresa tomou nas suas aquisições anteriores.
      Ex.: vender com alíquota zero mantém os créditos das compras;
           vender com isenção exige anulação proporcional desses créditos.

   2) Crédito do ADQUIRENTE daquela operação.
      É outra coisa. O comprador não ganha crédito só porque a operação teve
      alíquota zero: não houve IBS/CBS pago naquela operação, logo não há o
      que creditar. Essa dimensão entra na estimativa do percentual de
      compras creditáveis informado pelo usuário, e não nesta função.

   Não misturar as duas regras.
   ===================================================================== */

/** crédito potencial BRUTO estimado de IBS/CBS sobre as compras creditáveis.
    É o crédito antes de qualquer anulação exigida pelas saídas do período.

    TODO_FISCAL_VALIDATION_PURCHASE_MIX: o modo simples estima crédito a partir
    do percentual de compras creditáveis informado. O detalhamento do crédito
    conforme a tributação efetivamente suportada em cada aquisição, inclusive
    Simples Nacional, alíquota reduzida, alíquota zero, créditos presumidos e
    regimes específicos, será tratado em módulo próprio. */
function calculatePotentialCredits(P, aliqIbs, aliqCbs){
  var compras = naoNegativo(P.compras);
  var pct = Math.min(100, Math.max(0, num(P.pctCreditavel)));
  var base = compras * pct / 100;
  return {
    compras: compras, pctCreditavel: pct, base: base,
    ibs: base * num(aliqIbs) / 100,
    cbs: base * num(aliqCbs) / 100,
    get total(){ return this.ibs + this.cbs; }
  };
}

/** crédito bruto pelo MODO DETALHADO: só os grupos informados geram crédito.

    Regra por linha, sempre separada por tributo:
      creditoIBS = base × (IBS do ano) × fatorIbs
      creditoCBS = base × (CBS do ano) × fatorCbs

    O que sobra entre o total de compras e a soma dos grupos fica como
    "compras não classificadas" e gera crédito ZERO — conservador de propósito.

    TODO_FISCAL_VALIDATION_PRESUMED_CREDITS: as hipóteses legais específicas de
    crédito presumido (produtor rural e produtor rural integrado, transportador
    autônomo, MEI transportador, resíduos destinados à reciclagem, bens móveis
    usados para revenda, cooperativas e demais regimes) possuem regras próprias
    e NÃO são identificadas nem calculadas automaticamente nesta versão. O tipo
    PRESUMED_MANUAL apenas recebe fatores informados pelo usuário. */
function calculateDetailedPurchaseCredits(P, regras, ano){
  var r = regrasDoAno(regras, ano);
  var aliqIbs = num(r.ibs.valor), aliqCbs = num(r.cbs.valor);

  var tipos = {};
  ((regras.compras && regras.compras.tipos) || []).forEach(function(t){ tipos[t.id] = t; });

  var totalCompras = naoNegativo(P.compras);
  var linhas = [], classificadas = 0, credIbs = 0, credCbs = 0;

  (P.gruposCompras || []).forEach(function(g){
    var tipo = tipos[g.tipo] || tipos.REGULAR_FULL;
    var base = naoNegativo(g.valor);
    if(base <= 0) return;

    var lIbs, lCbs, detalheFator, aliqIbsAplicada, aliqCbsAplicada;
    var fatorIbs = null, fatorCbs = null;
    var semFator = false, precisaRevisao = false;

    if(tipo.pedeAliquotasCredito){
      // MODELO (b): a alíquota informada JÁ é a alíquota efetiva de crédito.
      // Não se multiplica pela alíquota do ano do cenário.
      var temNovos = (String(g.aliquotaCreditoIbs == null ? '' : g.aliquotaCreditoIbs).trim() !== '') ||
                     (String(g.aliquotaCreditoCbs == null ? '' : g.aliquotaCreditoCbs).trim() !== '');
      var temLegado = (String(g.fatorIbs == null ? '' : g.fatorIbs).trim() !== '') ||
                      (String(g.fatorCbs == null ? '' : g.fatorCbs).trim() !== '');
      // registro da Sprint 04 com fatores antigos e sem as novas alíquotas:
      // NÃO converter. Crédito zero até o usuário revisar.
      precisaRevisao = !temNovos && temLegado;

      aliqIbsAplicada = precisaRevisao ? 0 : Math.max(0, num(g.aliquotaCreditoIbs));
      aliqCbsAplicada = precisaRevisao ? 0 : Math.max(0, num(g.aliquotaCreditoCbs));
      lIbs = base * aliqIbsAplicada / 100;
      lCbs = base * aliqCbsAplicada / 100;
      semFator = !precisaRevisao && aliqIbsAplicada === 0 && aliqCbsAplicada === 0;
      detalheFator = precisaRevisao
        ? 'Modelo anterior de fatores — pendente de revisão'
        : 'Alíquota efetiva de crédito · IBS ' + aliqIbsAplicada.toLocaleString('pt-BR',{maximumFractionDigits:4}) +
          '% · CBS ' + aliqCbsAplicada.toLocaleString('pt-BR',{maximumFractionDigits:4}) + '%';
    } else {
      // MODELO (a): fator aplicado sobre a alíquota do ano
      if(tipo.pedeReducao){
        var red = Math.min(100, Math.max(0, num(g.reducao)));
        fatorIbs = fatorCbs = 1 - red/100;
        detalheFator = 'Redução de ' + red.toLocaleString('pt-BR',{maximumFractionDigits:2}) + '% na aquisição';
      } else if(tipo.pedeFatores){
        fatorIbs = Math.min(100, Math.max(0, num(g.fatorIbs))) / 100;
        fatorCbs = Math.min(100, Math.max(0, num(g.fatorCbs))) / 100;
        detalheFator = 'Fator IBS ' + (fatorIbs*100).toLocaleString('pt-BR',{maximumFractionDigits:2}) + '% · Fator CBS ' +
                       (fatorCbs*100).toLocaleString('pt-BR',{maximumFractionDigits:2}) + '%';
        semFator = fatorIbs === 0 && fatorCbs === 0;
      } else {
        fatorIbs = fatorCbs = num(tipo.fatorFixo);
        detalheFator = tipo.fatorFixo === 0 ? 'Sem crédito' : 'Alíquota integral do ano';
      }
      aliqIbsAplicada = aliqIbs * fatorIbs;
      aliqCbsAplicada = aliqCbs * fatorCbs;
      lIbs = base * aliqIbsAplicada / 100;
      lCbs = base * aliqCbsAplicada / 100;
    }

    classificadas += base;
    credIbs += lIbs;
    credCbs += lCbs;

    linhas.push({
      descricao: g.descricao || tipo.rotulo,
      valor: base,
      tipo: tipo.id,
      tipoRotulo: tipo.rotulo,
      aliqIbsAplicada: aliqIbsAplicada,
      aliqCbsAplicada: aliqCbsAplicada,
      fatorIbs: fatorIbs,
      fatorCbs: fatorCbs,
      aliquotaCreditoIbs: tipo.pedeAliquotasCredito ? aliqIbsAplicada : null,
      aliquotaCreditoCbs: tipo.pedeAliquotasCredito ? aliqCbsAplicada : null,
      reducao: tipo.pedeReducao ? Math.min(100, Math.max(0, num(g.reducao))) : null,
      detalheFator: detalheFator,
      creditoIbs: lIbs,
      creditoCbs: lCbs,
      creditoTotal: lIbs + lCbs,
      // classificação da linha x regra de cálculo aplicada
      classificationStatus: tipo.classificationStatus || 'USER_INPUT',
      ruleStatus: tipo.ruleStatus,
      ruleRotulo: tipo.ruleRotulo,
      semFatorInformado: semFator,
      legacySimpleCreditNeedsReview: precisaRevisao,
      fonte: tipo.fonte
    });
  });

  var naoClassificadas = totalCompras - classificadas;

  return {
    modo: 'DETAILED',
    totalCompras: totalCompras,
    comprasClassificadas: classificadas,
    comprasNaoClassificadas: naoClassificadas > 0 ? naoClassificadas : 0,
    excedente: naoClassificadas < 0 ? -naoClassificadas : 0,
    linhas: linhas,
    aliqIbs: aliqIbs, aliqCbs: aliqCbs,
    linhasPendentesRevisao: linhas.filter(function(l){ return l.legacySimpleCreditNeedsReview; }).length,
    // interface canônica de crédito bruto, igual à do modo simples.
    // ATENÇÃO: no modo detalhado, "base" e "pctCreditavel" existem só por
    // compatibilidade interna. Nunca apresentá-los ao usuário como "base
    // creditável" ou "percentual creditável" — uma linha NO_CREDIT está
    // classificada e mesmo assim não gera crédito.
    compras: totalCompras,
    pctCreditavel: totalCompras > 0 ? (classificadas / totalCompras) * 100 : 0,
    base: classificadas,
    ibs: credIbs,
    cbs: credCbs,
    creditoBrutoIBS: credIbs,
    creditoBrutoCBS: credCbs,
    creditoBrutoTotal: credIbs + credCbs,
    get total(){ return this.ibs + this.cbs; }
  };
}

/** validação do modo detalhado: a soma dos grupos não pode exceder as compras.
    Fail closed — nada é cortado nem rateado. */
function validatePurchaseClassification(P){
  var totalCompras = naoNegativo(P.compras);
  var soma = (P.gruposCompras || []).reduce(function(s,g){ return s + naoNegativo(g.valor); }, 0);
  var detalhado = P.purchaseCreditMode === 'DETAILED';
  var excesso = soma - totalCompras;
  var valido = !detalhado || excesso <= 0.005;

  return {
    aplicavel: detalhado,
    valido: valido,
    totalCompras: totalCompras,
    somaComprasDetalhadas: soma,
    comprasNaoClassificadas: detalhado && excesso < 0 ? -excesso : 0,
    excesso: valido ? 0 : excesso,
    mensagem: valido ? '' :
      'As compras detalhadas excedem o total mensal de compras em ' + BRL.format(excesso) +
      '. Revise os grupos antes de simular.'
  };
}

/** ajuste dos créditos em função dos TRATAMENTOS DE SAÍDA do período.
    Só as receitas cujo tratamento tem creditTreatment = PROPORTIONAL_REVERSAL
    entram no numerador — hoje, isenção e imunidade geral. Exportação, alíquota
    zero, reduções e tributação integral são MAINTAIN e não estornam nada.

    percentualEstorno = receitaEstorno / faturamentoTotal   (limitado a 0..100%)
    estorno{IBS,CBS}  = creditoBruto{IBS,CBS} × percentualEstorno
    utilizavel        = bruto − estorno,  calculado separadamente por tributo.

    TODO_FISCAL_VALIDATION: hipóteses legais específicas de imunidade com
    tratamento próprio de créditos (por exemplo livros e fonogramas) não são
    modeladas nesta versão; a opção IMUNIDADE representa a regra geral. */
function calculateOutputCreditAdjustment(P, tratamentoReceita, creditoBruto, regras){
  // usa o conjunto de regras do cenário; só cai no padrão se nada for informado
  var cfg = regras || FISCAL_RULES_PADRAO;
  var mapa = {};
  (cfg.tratamentosReceita || []).forEach(function(t){ mapa[t.id] = t; });

  var linhas = (tratamentoReceita && tratamentoReceita.linhas) || [];
  var receitaTotal = naoNegativo(tratamentoReceita && tratamentoReceita.faturamento);

  var receitaEstorno = 0, receitaMantem = 0, detalhe = [];
  linhas.forEach(function(l){
    var t = mapa[l.tratamento];
    var regra = (t && t.creditTreatment) || 'MAINTAIN';
    if(regra === 'PROPORTIONAL_REVERSAL'){
      receitaEstorno += naoNegativo(l.valor);
      detalhe.push({ descricao:l.descricao, tratamento:l.tratamento, valor:naoNegativo(l.valor) });
    } else {
      receitaMantem += naoNegativo(l.valor);
    }
  });

  var pct = receitaTotal > 0 ? (receitaEstorno / receitaTotal) : 0;
  if(!isFinite(pct) || pct < 0) pct = 0;
  if(pct > 1) pct = 1;

  var brutoIbs = naoNegativo(creditoBruto && creditoBruto.ibs);
  var brutoCbs = naoNegativo(creditoBruto && creditoBruto.cbs);
  var estornoIbs = brutoIbs * pct;
  var estornoCbs = brutoCbs * pct;

  return {
    receitaEstorno: receitaEstorno,
    receitaMantemCredito: receitaMantem,
    receitaTotal: receitaTotal,
    percentualEstorno: pct * 100,
    aplicavel: receitaEstorno > 0,
    linhasEstorno: detalhe,
    estorno: { ibs: estornoIbs, cbs: estornoCbs, total: estornoIbs + estornoCbs },
    utilizavel: { ibs: brutoIbs - estornoIbs, cbs: brutoCbs - estornoCbs,
                  total: (brutoIbs - estornoIbs) + (brutoCbs - estornoCbs) }
  };
}

/** tributos legados que permanecem no ano: ICMS, ISS e IPI residual */
function calculateLegacyTaxes(P, regras, ano){
  var r = regrasDoAno(regras, ano);
  var atual = calculateCurrentConsumptionTaxes(P);
  var fatorIcms = num(r.icmsRemanescente.valor) / 100;
  var fatorIss  = num(r.issRemanescente.valor) / 100;
  var ipiPadrao = atual.ipi * num(r.ipiPadrao.valor) / 100;
  var ipiResidual = (P.ipiResidual && P.ipiResidual.ativo) ? naoNegativo(P.ipiResidual.valor) : 0;
  return {
    icms: atual.icms * fatorIcms,
    iss:  atual.iss  * fatorIss,
    ipi:  ipiPadrao + ipiResidual,
    ipiResidualAplicado: ipiResidual,
    fatorIcms: num(r.icmsRemanescente.valor),
    fatorIss:  num(r.issRemanescente.valor),
    pisCofinsExtinto: r.pisCofins === 'EXTINTO',
    get total(){ return this.icms + this.iss + this.ipi; }
  };
}

/** Imposto Seletivo: R$ 0 salvo habilitação explícita com alíquota informada.
    TODO_FISCAL_VALIDATION: não há alíquota geral de IS definida em norma para
    uso automático. Enquanto o status for PENDING_LAW, só há cálculo com
    percentual personalizado informado pelo usuário para esta simulação. */
function calculateSelectiveTax(P, regras){
  var cfg = P.impostoSeletivo || {};
  var vazio = { aplicavel:false, base:0, aliquota:0, valor:0, status:'PENDING_LAW', categoria:null };
  if(!cfg.sujeita) return vazio;
  if(!cfg.usarCustom) {
    return { aplicavel:true, base:naoNegativo(cfg.base), aliquota:0, valor:0,
             status:'PENDING_LAW', categoria:cfg.categoria,
             aviso:'Operações sujeitas ao IS foram sinalizadas, mas nenhuma alíquota foi informada. O simulador não presume percentual.' };
  }
  var aliq = Math.max(0, num(cfg.aliquota));
  var base = naoNegativo(cfg.base);
  var cat = null;
  regras.impostoSeletivo.categorias.forEach(function(c){ if(c.id === cfg.categoria) cat = c; });
  var aviso = null;
  if(cat && cat.limiteMaximo && aliq > num(cat.limiteMaximo.valor)){
    aviso = 'A alíquota informada supera o limite legal máximo de ' +
            num(cat.limiteMaximo.valor).toLocaleString('pt-BR',{minimumFractionDigits:2}) + '% para ' + cat.rotulo.toLowerCase() + '.';
  }
  return { aplicavel:true, base:base, aliquota:aliq, valor: base * aliq / 100,
           status:'USER_CUSTOM', categoria:cfg.categoria, aviso:aviso };
}

/** carga complementar: médias históricas mantidas, nunca recalculadas */
function calculateComplementaryHistoricalLoad(P){
  var c = P.complementar || {};
  var irpjCsll = naoNegativo(c.irpjCsll);
  var patronais = naoNegativo(c.encargosPatronais);
  var proLabore = naoNegativo(c.encargosProLabore);
  return {
    irpjCsll: irpjCsll,
    encargosPatronais: patronais,
    encargosProLabore: proLabore,
    total: irpjCsll + patronais + proLabore,
    natureza: 'HISTORICAL'
  };
}

/** cenário completo de um ano da transição */
function calculateYearScenario(P, regras, ano){
  var r = regrasDoAno(regras, ano);
  var aliqIbs = num(r.ibs.valor), aliqCbs = num(r.cbs.valor);

  var atual       = calculateCurrentConsumptionTaxes(P);
  var tratamento  = calculateRevenueTreatment(P, regras);
  var debito      = calculateIbsCbsDebit(tratamento, aliqIbs, aliqCbs);
  // MODO DE COMPRA -> CRÉDITO BRUTO -> ESTORNO PELAS SAÍDAS -> CRÉDITO UTILIZÁVEL
  // Os dois modos devolvem a mesma interface canônica de crédito bruto.
  var modoCompras = P.purchaseCreditMode === 'DETAILED' ? 'DETAILED' : 'SIMPLE';
  var creditoBruto = (modoCompras === 'DETAILED')
    ? calculateDetailedPurchaseCredits(P, regras, ano)
    : calculatePotentialCredits(P, aliqIbs, aliqCbs);
  var ajuste      = calculateOutputCreditAdjustment(P, tratamento, creditoBruto, regras);
  var legado      = calculateLegacyTaxes(P, regras, ano);
  var seletivo    = calculateSelectiveTax(P, regras);
  var complementar= calculateComplementaryHistoricalLoad(P);

  // só o crédito UTILIZÁVEL (bruto menos o estorno exigido pelas saídas) abate o débito
  var credito = ajuste.utilizavel;

  // não cumulatividade por tributo: crédito de IBS abate IBS, crédito de CBS abate CBS.
  // O saldo credor NÃO é zerado silenciosamente — ele é devolvido em campo próprio.
  var ibsLiquido = debito.ibs - credito.ibs;
  var cbsLiquido = debito.cbs - credito.cbs;
  var ibsAPagar = Math.max(0, ibsLiquido);
  var cbsAPagar = Math.max(0, cbsLiquido);
  var saldoCredorIbs = Math.max(0, -ibsLiquido);
  var saldoCredorCbs = Math.max(0, -cbsLiquido);

  var consumoReforma = ibsAPagar + cbsAPagar + legado.total + seletivo.valor;
  var difMes = consumoReforma - atual.total;

  return {
    ano: ano,
    aliquotas: { ibs: aliqIbs, cbs: aliqCbs, statusIbs: r.ibs.status, statusCbs: r.cbs.status },
    atual: atual,
    tratamento: tratamento,
    debito: { ibs: debito.ibs, cbs: debito.cbs, total: debito.ibs + debito.cbs, base: debito.base },
    // crédito potencial bruto das aquisições, antes de qualquer anulação
    modoCompras: modoCompras,
    creditoBruto: { ibs: creditoBruto.ibs, cbs: creditoBruto.cbs, total: creditoBruto.ibs + creditoBruto.cbs,
                    base: creditoBruto.base, compras: creditoBruto.compras, pct: creditoBruto.pctCreditavel,
                    // campos explícitos do modo detalhado (não removem os anteriores)
                    comprasClassificadas: creditoBruto.comprasClassificadas != null ? creditoBruto.comprasClassificadas : null,
                    comprasNaoClassificadas: creditoBruto.comprasNaoClassificadas != null ? creditoBruto.comprasNaoClassificadas : null },
    // detalhamento dos grupos de aquisição (só no modo DETAILED)
    comprasDetalhe: modoCompras === 'DETAILED' ? creditoBruto : null,
    // anulação proporcional exigida pelas saídas isentas/imunes do período
    estorno: ajuste,
    // crédito efetivamente utilizado no encontro de contas (bruto − estorno)
    credito: { ibs: credito.ibs, cbs: credito.cbs, total: credito.ibs + credito.cbs,
               base: creditoBruto.base, compras: creditoBruto.compras, pct: creditoBruto.pctCreditavel },
    liquido: {
      ibs: ibsAPagar, cbs: cbsAPagar, total: ibsAPagar + cbsAPagar,
      saldoCredorIbs: saldoCredorIbs, saldoCredorCbs: saldoCredorCbs,
      saldoCredorTotal: saldoCredorIbs + saldoCredorCbs
    },
    legado: { icms: legado.icms, iss: legado.iss, ipi: legado.ipi, total: legado.total,
              fatorIcms: legado.fatorIcms, fatorIss: legado.fatorIss,
              ipiResidualAplicado: legado.ipiResidualAplicado },
    seletivo: seletivo,
    complementar: complementar,
    consumoReforma: consumoReforma,
    consumoAtual: atual.total,
    diferencaMes: difMes,
    diferencaAno: difMes * 12,
    diferencaPct: atual.total > 0 ? (difMes / atual.total) * 100 : null,
    completaAtual: atual.total + complementar.total,
    completaReforma: consumoReforma + complementar.total
  };
}

/** trajetória de todos os anos configurados */
function calculateTrajectory(P, regras){
  return regras.meta.anos.map(function(ano){ return calculateYearScenario(P, regras, ano); });
}

/* =====================================================================
   APRESENTAÇÃO — formatação, DOM e armazenamento
   ===================================================================== */

function money(n){ return BRL.format(isFinite(n) ? n : 0); }
function pctFmt(n,casas){ return (isFinite(n)?n:0).toLocaleString('pt-BR',{minimumFractionDigits:casas==null?2:casas,maximumFractionDigits:casas==null?2:casas}) + '%'; }
function esc(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function $(id){ return document.getElementById(id); }
function valNum(id){ return num($(id).value); }

/* ---------------- máscara de CNPJ ----------------
   Formata a cada tecla no padrão 00.000.000/0000-00, preservando a posição do
   cursor. Aceita o formato numérico e o alfanumérico (as 12 primeiras posições
   podem conter letras; os dois dígitos verificadores são sempre numéricos).
   Com 14 dígitos numéricos, a razão social é consultada nos dados públicos da
   Receita Federal (via BrasilAPI) e sugerida no campo Nome da empresa. */
function mascaraCNPJ(bruto){
  var s = String(bruto == null ? '' : bruto).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
  var base = s.slice(0, 12);
  var dv = s.slice(12, 14).replace(/[^0-9]/g, '');
  s = base + dv;
  var out = '';
  for(var i = 0; i < s.length; i++){
    if(i === 2 || i === 5) out += '.';
    else if(i === 8) out += '/';
    else if(i === 12) out += '-';
    out += s.charAt(i);
  }
  return out;
}
function formatarCampoCNPJ(preservarCursor){
  var el = $('cnpj');
  if(!el) return;
  var antes = el.value;
  var novo = mascaraCNPJ(antes);
  if(novo === antes) return;
  if(!preservarCursor){ el.value = novo; return; }
  // conta os caracteres úteis antes do cursor para recolocá-lo no mesmo ponto
  var pos = el.selectionStart == null ? antes.length : el.selectionStart;
  var uteis = antes.slice(0, pos).replace(/[^0-9A-Za-z]/g, '').length;
  el.value = novo;
  var i = 0, contados = 0;
  while(i < novo.length && contados < uteis){
    if(/[0-9A-Za-z]/.test(novo.charAt(i))) contados++;
    i++;
  }
  try { el.setSelectionRange(i, i); } catch(e){}
}

/* ---------------- consulta CNPJ (Receita Federal / dados públicos) ----------------
   O portal oficial (cnpjreva) exige CAPTCHA e não pode ser chamado direto do
   navegador. Usamos a BrasilAPI, que replica os dados abertos da Receita. */
var cnpjConsultaTimer = null;
var cnpjConsultaSeq = 0;
var cnpjUltimoConsultado = '';
var cnpjNomeAuto = '';

function digitosCNPJ(bruto){
  return String(bruto == null ? '' : bruto).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
}
function cnpjNumericoCompleto(bruto){
  var d = digitosCNPJ(bruto);
  return /^\d{14}$/.test(d) ? d : null;
}
function statusConsultaCNPJ(msg, tipo){
  var el = $('cnpjStatus');
  if(!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = 'help cnpj-status' + (tipo ? ' is-' + tipo : '');
}
function aplicarRazaoSocialCNPJ(nome){
  var el = $('empresa');
  if(!el || !nome) return;
  var atual = el.value.trim();
  // não sobrescreve nome digitado manualmente pelo usuário
  if(!atual || atual === cnpjNomeAuto){
    el.value = nome;
    cnpjNomeAuto = nome;
  }
}
function agendarConsultaCNPJ(){
  if(cnpjConsultaTimer) clearTimeout(cnpjConsultaTimer);
  cnpjConsultaTimer = setTimeout(function(){ consultarCNPJReceita(false); }, 450);
}
function consultarCNPJReceita(forcar){
  if(cnpjConsultaTimer){ clearTimeout(cnpjConsultaTimer); cnpjConsultaTimer = null; }
  var el = $('cnpj');
  if(!el) return;
  var bruto = digitosCNPJ(el.value);
  if(!bruto){
    statusConsultaCNPJ('', '');
    cnpjUltimoConsultado = '';
    return;
  }
  if(bruto.length < 14){
    statusConsultaCNPJ('', '');
    return;
  }
  var cnpj = cnpjNumericoCompleto(bruto);
  if(!cnpj){
    statusConsultaCNPJ('Consulta automática disponível apenas para CNPJ numérico.', 'warn');
    return;
  }
  if(!forcar && cnpj === cnpjUltimoConsultado) return;

  var seq = ++cnpjConsultaSeq;
  cnpjUltimoConsultado = cnpj;
  statusConsultaCNPJ('Consultando dados públicos da Receita Federal…', 'loading');

  fetch('https://brasilapi.com.br/api/cnpj/v1/' + cnpj, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  }).then(function(res){
    if(seq !== cnpjConsultaSeq) return null;
    if(res.status === 404){
      statusConsultaCNPJ('CNPJ não encontrado na base da Receita Federal.', 'err');
      return null;
    }
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function(dados){
    if(seq !== cnpjConsultaSeq || !dados) return;
    var nome = String(dados.razao_social || dados.nome_fantasia || '').trim();
    if(!nome){
      statusConsultaCNPJ('CNPJ localizado, mas sem razão social cadastrada.', 'warn');
      return;
    }
    aplicarRazaoSocialCNPJ(nome);
    var sit = dados.descricao_situacao_cadastral ? ' · Situação: ' + dados.descricao_situacao_cadastral : '';
    statusConsultaCNPJ('Razão social preenchida automaticamente' + sit + '.', 'ok');
  }).catch(function(){
    if(seq !== cnpjConsultaSeq) return;
    cnpjUltimoConsultado = '';
    statusConsultaCNPJ('Não foi possível consultar o CNPJ agora. Preencha o nome manualmente.', 'err');
  });
}

/* ---------------- campos em reais: leitura e máscara ----------------
   Os campos monetários passaram a ser <input type="text"> para poder exibir
   "500.000,00" enquanto o usuário digita. Toda leitura desses campos usa
   parseBR(), que devolve um número puro ao motor — o motor continua recebendo
   exatamente os mesmos valores de antes. */
function parseBR(v){
  var s = String(v == null ? '' : v).replace(/\s|R\$/g, '').trim();
  if(!s) return 0;
  if(s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');  // vírgula é o decimal
  else s = s.replace(/\.(?=\d{3}(?:\D|$))/g, '');                      // ponto de milhar
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function valMoeda(id){ return parseBR($(id).value); }

/** número -> "500.000,00" (usado ao carregar clientes e ao semear exemplos) */
function formatarMoedaValor(n){
  n = parseFloat(n);
  if(!isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

/** máscara de digitação: cada dígito entra pela direita, alimentando os centavos.
    5 -> 0,05 · 50 -> 0,50 · 50000000 -> 500.000,00 */
function mascaraMoedaDigitando(bruto){
  var d = String(bruto == null ? '' : bruto).replace(/\D/g, '').slice(0, 15);
  d = d.replace(/^0+(?=\d)/, '');          // remove zeros à esquerda
  if(!d) return '';
  while(d.length < 3) d = '0' + d;         // garante ao menos 0,xx
  var centavos = d.slice(-2);
  var inteiros = d.slice(0, -2);
  return Number(inteiros).toLocaleString('pt-BR') + ',' + centavos;
}

/** aplica a máscara mantendo o cursor no fim (digitação da direita para a esquerda) */
function aoDigitarMoeda(el){
  var novo = mascaraMoedaDigitando(el.value);
  if(novo === el.value) return;
  el.value = novo;
  try { el.setSelectionRange(novo.length, novo.length); } catch(e){}
}

/** normaliza um campo já preenchido (ex.: cliente salvo com "500000") */
function normalizarCampoMoeda(el){
  if(!el) return;
  if(String(el.value).trim() === '') return;
  el.value = formatarMoedaValor(parseBR(el.value));
}

/* campos em reais fixos no formulário */
var CAMPOS_MOEDA = ['faturamento','compras','atualPis','atualCofins','atualPisCofins',
  'atualIcms','atualIss','atualIpi',
  'irpj','csll','irpjCsll','encargosPatronais','encargosProLabore','isBase','ipiResidualValor',
  'pisBase','cofinsBase','icmsBase','issBase','ipiBase'];

function ligarMoeda(el){
  if(!el || el.getAttribute('data-moeda') === '1') return;
  el.setAttribute('data-moeda','1');
  el.addEventListener('input', function(){ aoDigitarMoeda(this); });
}
function prepararCamposMoeda(){ CAMPOS_MOEDA.forEach(function(id){ ligarMoeda($(id)); }); }
function normalizarTodosOsCamposMoeda(){ CAMPOS_MOEDA.forEach(function(id){ normalizarCampoMoeda($(id)); }); }

/* =====================================================================
   SITUAÇÃO ATUAL DETALHADA E CARGA TRIBUTÁRIA
   ---------------------------------------------------------------------
   Tudo aqui é NORMALIZAÇÃO e APRESENTAÇÃO. Nenhuma destas funções altera
   ou duplica o motor: o modo detalhado apenas produz os quatro totais que
   o motor já esperava em P.atual, do mesmo modo que VALUE/RATE e a
   periodicidade do IRPJ/CSLL já fazem.

   IMPLEMENTADO na Sprint 09 — RELATÓRIO REPRESENTATIVO: botão próprio
   "Gerar relatório representativo", executivo e visual, montado por
   montarCorpoRepresentativo(). Sem memória técnica, sem tabela completa de
   premissas e sem diagnóstico longo. (Resolve o antigo marcador
   RELATORIO_REPRESENTATIVO.)

   IMPLEMENTADO na Sprint 09 — RELATÓRIO COM CÁLCULOS: botão próprio
   "Gerar relatório com cálculos", montado por montarCorpoCalculos(), com as
   memórias da Sprint 08 incorporadas ao documento: carga tributária,
   VALUE/RATE, débito de IBS/CBS, créditos, estorno e valores históricos.
   (Resolve o antigo marcador RELATORIO_COM_CALCULOS.)

   IMPLEMENTADO na Sprint 10 — RELATÓRIO COMPLETO DA TRANSIÇÃO: documento
   próprio da trajetória inteira, montado por montarCorpoCompleto(). Traz capa,
   panorama comparativo dos sete anos, alíquotas da transição, gráfico e a
   composição estrutural da empresa uma única vez; em seguida uma ficha por ano,
   cada uma em folha própria e reapresentando a identificação do cliente e a
   logomarca configurada; encerra com premissas da trajetória, metodologia,
   fontes e disclaimer. Não é a repetição dos outros dois relatórios e não
   recalcula nenhum ano: consome a trajetória T já produzida pelo motor.

   DECISÃO (Sprint 08.1, tomada pelo usuário após teste real): SIMPLE mantém
   estruturas separadas; DETAILED utiliza estrutura unificada de receitas
   contendo situação atual e tratamento Reforma na mesma linha. Clientes
   salvos no modelo anterior continuam calculando como antes até que a
   consolidação seja confirmada manualmente pelo usuário.
   (Substitui o antigo marcador UX_REVENUE_UNIFICATION_DECISION, já resolvido.)
   ===================================================================== */

/* naturezas apenas descritivas: não aplicam nenhuma regra tributária */
var NATUREZAS_RECEITA = [
  { id:'comercio',  rotulo:'Comércio' },
  { id:'industria', rotulo:'Indústria' },
  { id:'servicos',  rotulo:'Serviços' },
  { id:'transporte',rotulo:'Transporte' },
  { id:'outros',    rotulo:'Outros' }
];
function rotuloNatureza(id){
  var r = 'Outros';
  NATUREZAS_RECEITA.forEach(function(n){ if(n.id === id) r = n.rotulo; });
  return r;
}

/** soma as linhas do faturamento atual detalhado e devolve os totais por
    tributo, no mesmo formato que o motor já consome em P.atual. */
function normalizeDetailedCurrentRevenue(linhas){
  var t = { faturamentoDetalhado:0, pisCofins:0, icms:0, iss:0, ipi:0, totalTributos:0,
            linhas:[], origem:'DETAILED' };
  (linhas || []).forEach(function(l){
    var fat = Math.max(0, parseBR(l.faturamento));
    var pis = Math.max(0, parseBR(l.pisCofins));
    var icm = Math.max(0, parseBR(l.icms));
    var iss = Math.max(0, parseBR(l.iss));
    var ipi = Math.max(0, parseBR(l.ipi));
    var trib = pis + icm + iss + ipi;
    t.faturamentoDetalhado += fat;
    t.pisCofins += pis; t.icms += icm; t.iss += iss; t.ipi += ipi;
    t.totalTributos += trib;
    t.linhas.push({
      descricao: l.descricao || '(sem descrição)',
      natureza: l.natureza || 'outros',
      naturezaRotulo: rotuloNatureza(l.natureza),
      faturamento: fat, pisCofins: pis, icms: icm, iss: iss, ipi: ipi,
      tributos: trib,
      // relação matemática entre o que foi informado e a receita da linha —
      // NÃO é alíquota fiscal
      cargaEfetiva: fat > 0 ? (trib / fat) * 100 : null
    });
  });
  return t;
}

/** rastreabilidade dos tributos atuais no modo DETALHADO.
    Sem isto, a origem exibida continuaria vindo dos campos SIMPLE ignorados,
    dizendo "média histórica" ou mostrando base × alíquota que não entrou na conta. */
function buildDetailedCurrentTaxTrace(detAtual){
  var n = (detAtual && detAtual.linhas) ? detAtual.linhas.length : 0;
  var texto = 'Somado do detalhamento de ' + n + (n === 1 ? ' operação' : ' operações');
  function t(valor){
    return { modo:'DETAILED', valor: valor, operacoes: n,
             base:null, aliquota:null, pis:null, cofins:null,
             origemStatus:'USER_INPUT', origem: texto };
  }
  var pc = t(detAtual ? detAtual.pisCofins : 0);
  /* Componentes separados só existem no modelo unificado e apenas quando
     TODAS as linhas já os possuem. O modelo anterior (schema 1) é sempre
     combinado: sem esta checagem ele declararia pis/cofins com valor
     indefinido, que a apresentação exibiria como R$ 0,00. */
  if(detAtual && detAtual.origem === 'DETAILED_UNIFIED' && !detAtual.linhasCombinadoLegado){
    // sem modo:'DETAILED' o textoOrigem() cairia no ramo padrão e diria
    // "média histórica informada", contradizendo ICMS/ISS na mesma tabela
    pc.pis    = { modo:'DETAILED', valor: detAtual.pis,    operacoes: n,
                  base:null, aliquota:null, origemStatus:'USER_INPUT', origem: texto };
    pc.cofins = { modo:'DETAILED', valor: detAtual.cofins, operacoes: n,
                  base:null, aliquota:null, origemStatus:'USER_INPUT', origem: texto };
  } else if(detAtual){
    pc.combinadoLegado = true;
  }
  return {
    pisCofins: pc,
    icms:      t(detAtual ? detAtual.icms : 0),
    iss:       t(detAtual ? detAtual.iss : 0),
    ipi:       t(detAtual ? detAtual.ipi : 0)
  };
}

/** fail closed: no modo detalhado, a soma das linhas tem de bater com o
    faturamento informado. Nada é rateado nem completado automaticamente. */
function validateDetailedCurrentRevenue(P){
  var aplicavel = P.currentRevenueMode === 'DETAILED';
  var total = Math.max(0, num(P.faturamento));
  var det = P.atualDetalhado ? P.atualDetalhado.faturamentoDetalhado : 0;
  var dif = det - total;
  // compara em centavos: somar 300.000 + 200.000 + 99.999,99 em ponto flutuante
  // devolve 599.999,98999... e uma diferença de exatamente 1 centavo seria
  // rejeitada por ruído binário. Arredondar antes torna a tolerância exata.
  var difCent = Math.round(dif * 100) / 100;
  var valido = !aplicavel || Math.abs(difCent) <= 0.01;
  var msg = '';
  if(!valido){
    msg = dif < 0
      ? 'O faturamento detalhado está ' + BRL.format(Math.abs(difCent)) + ' abaixo do faturamento total. Revise as linhas antes de simular.'
      : 'O faturamento detalhado excede o faturamento total em ' + BRL.format(difCent) + '. Revise as linhas antes de simular.';
  }
  return { aplicavel:aplicavel, valido:valido, faturamentoTotal:total,
           faturamentoDetalhado:det, diferenca:valido ? 0 : difCent, mensagem:msg };
}

/* =====================================================================
   MODELO UNIFICADO DE RECEITAS — schema 2
   ---------------------------------------------------------------------
   DECISÃO (Sprint 08.1): o modo SIMPLE mantém as estruturas separadas; o modo
   DETAILED passa a usar uma única tabela em que cada linha traz, ao mesmo
   tempo, como a operação é tributada HOJE e qual tratamento de IBS/CBS está
   sendo considerado na Reforma.

   Esta camada é helper de APRESENTAÇÃO/NORMALIZAÇÃO. Ela roda antes do motor
   e devolve exatamente os mesmos objetos canônicos que o motor já consumia:
     - P.atual              (soma dos tributos das linhas)
     - P.receitasEspeciais  (uma entrada por linha, com o tratamento escolhido)
     - P.pctExportacao = 0  (a exportação passa a vir das próprias linhas)
   Nenhuma regra fiscal é inferida a partir dos valores informados: o fato de
   uma linha ter ICMS zero NÃO define tratamento algum na Reforma.
   ===================================================================== */
var UNIFICADO_SCHEMA = 2;

/** rótulo e fator de um tratamento, sem inventar nada fora do FISCAL_RULES */
function tratamentoPorId(id, regras){
  var achado = null;
  (regras || FISCAL_RULES).tratamentosReceita.forEach(function(t){ if(t.id === id) achado = t; });
  return achado;
}

/** soma as linhas unificadas e devolve, no MESMO formato de
    normalizeDetailedCurrentRevenue, os totais da situação atual — mais o
    tratamento de Reforma de cada linha, que o modelo anterior não carregava. */
function normalizeUnifiedRevenue(linhas, regras){
  var R = regras || FISCAL_RULES;
  var t = { faturamentoDetalhado:0, pisCofins:0, pis:0, cofins:0, icms:0, iss:0, ipi:0, totalTributos:0,
            linhas:[], origem:'DETAILED_UNIFIED', schema:UNIFICADO_SCHEMA,
            semTratamento:0, porTratamento:[], linhasCombinadoLegado:0 };
  var acumulado = {};
  (linhas || []).forEach(function(l){
    var fat = Math.max(0, parseBR(l.faturamento));
    var pc  = pisCofinsDaLinha(l);
    var pis = pc.total;                       // agregado canônico da linha
    var icm = Math.max(0, parseBR(l.icms));
    var iss = Math.max(0, parseBR(l.iss));
    var ipi = Math.max(0, parseBR(l.ipi));
    var trib = pis + icm + iss + ipi;         // a carga efetiva não muda de fórmula
    var tr = tratamentoPorId(l.tratamentoReforma, R);
    // linha sem tratamento escolhido não é presumida como integral: fica marcada
    var pendente = !tr;
    var pct = tr && tr.pctEditavel ? Math.min(100, Math.max(0, num(l.pctCustom))) : null;
    var fator = !tr ? null : (tr.pctEditavel ? 1 - pct/100 : tr.fatorAliquota);

    t.faturamentoDetalhado += fat;
    t.pisCofins += pis; t.icms += icm; t.iss += iss; t.ipi += ipi;
    if(pc.combinadoLegado){ t.linhasCombinadoLegado++; }
    else { t.pis += pc.pis; t.cofins += pc.cofins; }
    t.totalTributos += trib;
    if(pendente && fat > 0) t.semTratamento++;

    t.linhas.push({
      descricao: l.descricao || '(sem descrição)',
      natureza: l.natureza || 'outros',
      naturezaRotulo: rotuloNatureza(l.natureza),
      faturamento: fat, pisCofins: pis, pis: pc.pis, cofins: pc.cofins,
      pisCofinsCombinadoLegado: pc.combinadoLegado,
      icms: icm, iss: iss, ipi: ipi,
      tributos: trib,
      // relação matemática entre o informado e a receita da linha — não é alíquota fiscal
      cargaEfetiva: fat > 0 ? (trib / fat) * 100 : null,
      tratamentoReforma: tr ? tr.id : null,
      tratamentoRotulo: tr ? tr.rotulo : 'Selecione / revise',
      tratamentoPendente: pendente,
      pctCustom: pct,
      fatorAliquota: fator,
      creditTreatment: tr ? tr.creditTreatment : null
    });

    if(tr && fat > 0){
      if(!acumulado[tr.id]) acumulado[tr.id] = { id:tr.id, rotulo:tr.rotulo, valor:0, operacoes:0 };
      acumulado[tr.id].valor += fat;
      acumulado[tr.id].operacoes++;
    }
  });
  // ordem estável: a mesma do FISCAL_RULES, para conferência
  R.tratamentosReceita.forEach(function(x){ if(acumulado[x.id]) t.porTratamento.push(acumulado[x.id]); });
  return t;
}

/** converte as linhas unificadas para o formato que calculateRevenueTreatment
    já consome. Todas as linhas entram, inclusive as de tributação integral —
    por isso o residual do motor fica zerado e não há receita silenciosa. */
function unifiedToEngineRevenue(det){
  return (det && det.linhas ? det.linhas : []).filter(function(l){ return !l.tratamentoPendente; })
    .map(function(l){
      return { descricao: l.descricao, valor: l.faturamento,
               tratamento: l.tratamentoReforma, pctCustom: l.pctCustom == null ? 0 : l.pctCustom };
    });
}

/** fail closed do modelo unificado: nenhuma linha pode ficar sem tratamento.
    Não existe padrão implícito para linha já existente. */
function validateUnifiedTreatments(P){
  var aplicavel = !!P.revenueModelUnified;
  var n = (aplicavel && P.atualDetalhado) ? P.atualDetalhado.semTratamento : 0;
  var valido = !aplicavel || n === 0;
  return { aplicavel:aplicavel, valido:valido, pendentes:n,
    mensagem: valido ? '' :
      (n === 1 ? 'Há 1 operação sem tratamento de IBS/CBS selecionado. '
               : 'Há ' + n + ' operações sem tratamento de IBS/CBS selecionado. ') +
      'Escolha o tratamento de cada linha antes de simular.' };
}

/** acrescenta os componentes de PIS e Cofins à rastreabilidade do modo VALUE.
    No modo RATE a separação já vem pronta da função pura, com base e alíquota
    de cada tributo — ali não há estimativa nova a fazer. */
function enriquecerPisCofins(detalhe, entradas){
  var d = detalhe && detalhe.pisCofins;
  var e = entradas && entradas.pisCofins;
  if(!d || !e || d.modo === 'RATE') return detalhe;
  if(e.combinadoLegado){
    d.combinadoLegado = true;
    d.origem = 'Média histórica informada em valor combinado';
    return detalhe;
  }
  d.combinadoLegado = false;
  d.pis    = { valor: e.valorPis,    origemStatus:'HISTORICAL', origem:'Média histórica informada' };
  d.cofins = { valor: e.valorCofins, origemStatus:'HISTORICAL', origem:'Média histórica informada' };
  return detalhe;
}

/** percentual sobre o faturamento; null quando não há faturamento */
function pctSobreFaturamento(valor, faturamento){
  if(!(faturamento > 0)) return null;
  return (valor / faturamento) * 100;
}

/** carga tributária por esfera, separando tributos de encargos.
    Usa exclusivamente valores canônicos já produzidos pelo cenário —
    nenhum IBS/CBS é recalculado aqui.

    Federais ................ PIS/Cofins, IPI e IRPJ/CSLL hoje;
                              CBS a recolher, IPI do cenário, IS e IRPJ/CSLL na Reforma.
    Estaduais e municipais .. ICMS e ISS hoje;
                              IBS a recolher, ICMS e ISS remanescentes na Reforma.
    O IBS entra em "Estaduais e municipais" por ter competência compartilhada
    entre Estados, DF e Municípios. O simulador não rateia o IBS entre esferas.

    Saldo credor NÃO é tratado como imposto negativo: cada esfera usa apenas
    o valor a recolher de cada tributo. */
function calculateTaxBurdenBreakdown(R, P){
  var fat = Math.max(0, num(P.faturamento));
  var irpj = Math.max(0, num(P.complementar.irpjCsll));
  var encargos = Math.max(0, num(P.complementar.encargosPatronais)) +
                 Math.max(0, num(P.complementar.encargosProLabore));

  var atualFed = R.atual.pisCofins + R.atual.ipi + irpj;
  var atualEst = R.atual.icms + R.atual.iss;
  var atualTrib = atualFed + atualEst;

  var refFed = R.liquido.cbs + R.legado.ipi + R.seletivo.valor + irpj;
  var refEst = R.liquido.ibs + R.legado.icms + R.legado.iss;
  var refTrib = refFed + refEst;

  function bloco(valor){ return { valor: valor, pct: pctSobreFaturamento(valor, fat) }; }

  return {
    ano: R.ano,
    faturamento: fat,
    atual: {
      federais: bloco(atualFed),
      estaduaisMunicipais: bloco(atualEst),
      tributaria: bloco(atualTrib),
      encargos: bloco(encargos),
      completa: bloco(atualTrib + encargos)
    },
    reforma: {
      federais: bloco(refFed),
      estaduaisMunicipais: bloco(refEst),
      tributaria: bloco(refTrib),
      encargos: bloco(encargos),
      completa: bloco(refTrib + encargos)
    },
    // conferência de coerência com os totais já produzidos pelo cenário
    reconciliaAtual: Math.abs((atualTrib + encargos) - R.completaAtual) <= 0.01,
    reconciliaReforma: Math.abs((refTrib + encargos) - R.completaReforma) <= 0.01
  };
}

/* ---------------- dados do escritório ----------------
   Guardados em chave própria e global: o escritório é o mesmo para todos os
   clientes salvos neste navegador. Não interfere em nenhum cálculo. */
var LS_ESCRITORIO = 'fiscalcode_lucroreal_escritorio_v1';
var escritorio = { nome:'', cnpj:'', registro:'', contato:'', logo:'', escala:100 };

function lerEscritorio(){
  try { return JSON.parse(localStorage.getItem(LS_ESCRITORIO)) || null; } catch(e){ return null; }
}
function gravarEscritorio(){
  try { localStorage.setItem(LS_ESCRITORIO, JSON.stringify(escritorio)); return true; }
  catch(e){ return false; }
}
function escFlash(msg, erro){
  var m = $('escMsg'); if(!m) return;
  m.textContent = msg; m.className = 'ws-msg' + (erro ? ' err' : '');
  if(escFlash._t) clearTimeout(escFlash._t);
  escFlash._t = setTimeout(function(){ m.textContent = ''; }, 4000);
}
function logoFlash(msg, erro){
  var m = $('escLogoMsg'); if(!m) return;
  m.textContent = msg; m.className = 'logo-msg' + (erro ? ' err' : '');
  if(logoFlash._t) clearTimeout(logoFlash._t);
  logoFlash._t = setTimeout(function(){ m.textContent = ''; }, 5000);
}

/** reduz a imagem antes de guardar: o localStorage é pequeno e a logo é
    exibida em cerca de 190x66 no relatório (guardamos o dobro, para impressão) */
function reduzirLogo(file, aoConcluir){
  var leitor = new FileReader();
  leitor.onload = function(){
    var dados = String(leitor.result);
    if(/^data:image\/svg/.test(dados)){ aoConcluir(dados); return; }   // SVG não precisa reduzir
    var img = new Image();
    img.onload = function(){
      var maxL = 420, maxA = 150;
      var escala = Math.min(1, maxL / img.width, maxA / img.height);
      var l = Math.max(1, Math.round(img.width * escala));
      var a = Math.max(1, Math.round(img.height * escala));
      var cv = document.createElement('canvas');
      cv.width = l; cv.height = a;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, l, a);
      var saida;
      try { saida = cv.toDataURL('image/png'); } catch(e){ saida = dados; }
      // se o PNG ficar muito pesado, tenta JPEG
      if(saida.length > 400000){
        try { saida = cv.toDataURL('image/jpeg', 0.85); } catch(e){}
      }
      aoConcluir(saida);
    };
    img.onerror = function(){ aoConcluir(null); };
    img.src = dados;
  };
  leitor.onerror = function(){ aoConcluir(null); };
  leitor.readAsDataURL(file);
}

/** preenche os campos a partir do estado. Só é chamada ao CARREGAR — nunca
    durante a digitação, senão reescrever o input apaga o espaço recém-digitado. */
function renderEscritorio(){
  $('escNome').value = escritorio.nome || '';
  $('escCnpj').value = escritorio.cnpj || '';
  $('escRegistro').value = escritorio.registro || '';
  $('escContato').value = escritorio.contato || '';
  $('escLogoEscala').value = escritorio.escala || 100;
  $('escLogoEscalaVal').textContent = (escritorio.escala || 100) + '%';
  document.documentElement.style.setProperty('--logoEscala', (escritorio.escala || 100) / 100);
  var prev = $('escLogoPrev');
  if(escritorio.logo){
    prev.innerHTML = '<img alt="Logomarca do escritório" src="' + escritorio.logo + '">';
  } else {
    prev.innerHTML = '<span>Sem logomarca</span>';
  }
  var partes = [];
  if(escritorio.nome) partes.push(escritorio.nome);
  if(escritorio.registro) partes.push(escritorio.registro);
  $('escResumo').textContent = partes.length
    ? partes.join(' · ') + (escritorio.logo ? ' · com logomarca' : '')
    : 'Logomarca, nome, CNPJ e registro profissional (CRC, OAB ou equivalente).';
}

/** atualiza só o que não é campo de digitação: preview da logo, escala e resumo */
function atualizarResumoEscritorio(){
  $('escLogoEscalaVal').textContent = (escritorio.escala || 100) + '%';
  document.documentElement.style.setProperty('--logoEscala', (escritorio.escala || 100) / 100);
  var prev = $('escLogoPrev');
  prev.innerHTML = escritorio.logo
    ? '<img alt="Logomarca do escritório" src="' + escritorio.logo + '">'
    : '<span>Sem logomarca</span>';
  var partes = [];
  if(String(escritorio.nome).trim()) partes.push(String(escritorio.nome).trim());
  if(String(escritorio.registro).trim()) partes.push(String(escritorio.registro).trim());
  $('escResumo').textContent = partes.length
    ? partes.join(' · ') + (escritorio.logo ? ' · com logomarca' : '')
    : 'Logomarca, nome, CNPJ e registro profissional (CRC, OAB ou equivalente).';
}

/** guarda o que está na tela. Os textos vão CRUS: espaços internos e finais
    são preservados enquanto se digita; o trim acontece só ao consumir. */
function salvarEscritorioDaTela(){
  escritorio.nome = $('escNome').value;
  escritorio.cnpj = $('escCnpj').value;
  escritorio.registro = $('escRegistro').value;
  escritorio.contato = $('escContato').value;
  escritorio.escala = parseInt($('escLogoEscala').value, 10) || 100;
  if(!gravarEscritorio()) escFlash('Não foi possível guardar os dados do escritório neste navegador.', true);
  atualizarResumoEscritorio();
}

/** valor do escritório pronto para exibição (aí sim sem espaços nas pontas) */
function escTexto(campo){ return String(escritorio[campo] == null ? '' : escritorio[campo]).trim(); }

/* ---------------- periodicidade do IRPJ + CSLL ----------------
   Normaliza para valor MENSAL antes do motor, do mesmo modo que VALUE/RATE
   faz com os tributos atuais. O motor continua recebendo reais por mês. */
function periodicidadeIrpj(){
  return $('irpjPeriodicidade').value === 'TRIMESTRAL' ? 'TRIMESTRAL' : 'MENSAL';
}
/** normaliza IRPJ e CSLL separadamente e devolve também o agregado canônico.
    Trimestral divide CADA componente por 3 — nunca o total já somado. */
function normalizarIrpjCsll(){
  var trimestral = periodicidadeIrpj() === 'TRIMESTRAL';
  function mensal(v){ return trimestral ? v / 3 : v; }
  /* Como no PIS/Cofins: o agregado antigo é referência, não entrada. Enquanto a
     migração estiver pendente a simulação é bloqueada; o que chega ao motor é
     sempre a soma dos dois componentes informados. */
  var ir = valMoeda('irpj'), cs = valMoeda('csll');
  return { periodicidade: periodicidadeIrpj(), combinadoLegado: false,
           pendenteLegado: irpjCsllPendenteLegado,
           legadoValor: irpjCsllLegadoValor,
           legadoPeriodicidade: irpjCsllLegadoPeriodicidade,
           irpj: { informado: ir, mensal: mensal(ir) },
           csll: { informado: cs, mensal: mensal(cs) },
           combinado: null,
           totalMensal: mensal(ir) + mensal(cs) };
}

/** os dois campos foram efetivamente preenchidos pelo usuário? */
function irpjCsllInformados(){
  return String($('irpj').value).trim() !== '' && String($('csll').value).trim() !== '';
}

/** agregado que o motor complementar continua recebendo */
function irpjCsllMensal(){
  return normalizarIrpjCsll().totalMensal;
}
function sincronizarIrpj(){
  var n = normalizarIrpjCsll();
  var trimestral = n.periodicidade === 'TRIMESTRAL';
  $('irpjHelp').textContent = trimestral
    ? 'Informe o total apurado no trimestre em cada tributo. O simulador divide cada um por 3 para compor a média mensal.'
    : 'Médias mensais efetivamente apuradas. O simulador não calcula IRPJ nem CSLL.';

  /* Os campos separados estão SEMPRE visíveis. O painel de migração aparece ao
     lado deles enquanto houver pendência — nunca no lugar deles. */
  $('irLegado').className = 'legado-nota' + (n.pendenteLegado ? '' : ' hidden');
  if(n.pendenteLegado){
    $('irLegadoRef').textContent = money(n.legadoValor);
    $('irLegadoPer').textContent = n.legadoPeriodicidade === 'TRIMESTRAL'
      ? '(informado como média trimestral)' : '(informado como média mensal)';
    renderConferenciaMigracao({
      painel: 'irConf', aceiteBox: 'irAceiteBox', aceite: 'irAceite', botao: 'irConfirmar',
      legado: n.legadoValor,
      novo: n.irpj.informado + n.csll.informado,
      informados: irpjCsllInformados(),
      rotuloLegado: 'Valor combinado anterior',
      rotuloNovo: 'Novo total informado'
    });
  }

  function conv(id, comp){
    var c = $(id);
    if(trimestral && comp && comp.informado > 0){
      c.className = 'conv on';
      c.textContent = 'Equivale a ' + money(comp.mensal) + ' por mês (' + money(comp.informado) + ' ÷ 3).';
    } else { c.className = 'conv'; c.textContent = ''; }
  }
  conv('irpjConv', n.irpj);
  conv('csllConv', n.csll);

  $('irSoma').innerHTML = '<span>Total mensal utilizado na carga completa</span><b>' + money(n.totalMensal) + '</b>';
}

/** soma exibida de PIS + Cofins e bloco de compatibilidade */
function sincronizarPisCofins(){
  var pc = valoresPisCofinsValue();
  // os dois campos ficam sempre na tela; o painel de migração é adicional
  $('pcLegado').className = 'legado-nota' + (pc.pendente ? '' : ' hidden');
  $('pcSoma').innerHTML = '<span>Total de PIS e Cofins considerado</span><b>' + money(pc.total) + '</b>';
  if(pc.pendente){
    $('pcLegadoRef').textContent = money(pc.legado);
    renderConferenciaMigracao({
      painel: 'pcConf', aceiteBox: 'pcAceiteBox', aceite: 'pcAceite', botao: 'pcConfirmar',
      legado: pc.legado, novo: pc.total, informados: pisCofinsInformados(),
      rotuloLegado: 'Valor combinado anterior',
      rotuloNovo: 'Novo total informado'
    });
  }
}

/* =====================================================================
   CONFERÊNCIA DA MIGRAÇÃO DE UM AGREGADO LEGADO
   ---------------------------------------------------------------------
   Mesma mecânica para PIS/Cofins e para IRPJ/CSLL: mostra lado a lado o
   total antigo e o novo, e trata a diferença como decisão do usuário.

   Diferença NÃO bloqueia: o contador pode estar corrigindo um histórico
   errado, e a ferramenta não tem como saber qual dos dois números é o
   certo. Mas também não passa em silêncio — exige aceite explícito antes
   de substituir o valor que estava salvo.
   ===================================================================== */
function renderConferenciaMigracao(cfg){
  var dif = Math.round((cfg.novo - cfg.legado) * 100) / 100;
  var h = '<div class="mig-l"><span>' + esc(cfg.rotuloLegado) + '</span><b>' + money(cfg.legado) + '</b></div>' +
          '<div class="mig-l"><span>' + esc(cfg.rotuloNovo) + '</span><b>' + money(cfg.novo) + '</b></div>';

  if(!cfg.informados){
    h += '<div class="mig-dif">Informe os dois valores acima para concluir a revisão.</div>';
  } else if(dif === 0){
    h += '<div class="mig-ok">Os dois valores somam exatamente o total anterior.</div>';
  } else {
    h += '<div class="mig-dif">O novo total difere em ' + money(Math.abs(dif)) +
         (dif > 0 ? ' a mais' : ' a menos') + ' em relação ao valor combinado anteriormente salvo. ' +
         'Confirme se a alteração é intencional.</div>';
  }
  $(cfg.painel).innerHTML = h;

  // o aceite só é exigido quando há diferença de fato
  var precisaAceite = cfg.informados && dif !== 0;
  $(cfg.aceiteBox).className = 'chk mig-aceite' + (precisaAceite ? '' : ' hidden');
  if(!precisaAceite) $(cfg.aceite).checked = false;
  $(cfg.botao).disabled = !cfg.informados || (precisaAceite && !$(cfg.aceite).checked);
}

/* ---------------- roda do mouse não altera campos numéricos ----------------
   Rolar a página sobre um input numérico focado alterava o valor sem querer,
   o que é perigoso numa ferramenta fiscal. */
function bloquearRodaEmNumeros(){
  document.addEventListener('wheel', function(e){
    var el = e.target;
    if(el && el.tagName === 'INPUT' && el.type === 'number' && el === document.activeElement){
      el.blur();   // devolve a rolagem à página e preserva o valor digitado
    }
  }, { passive: true });
}

/** etiqueta visual do status de uma premissa */
function tagStatus(chave){
  var s = STATUS[chave]; if(!s) return '';
  return '<span class="st st-'+chave+'" title="'+esc(s.desc)+'">'+esc(s.rotulo)+'</span>';
}
function rotuloFonte(id){
  if(!id) return '—';
  var f = FISCAL_RULES.fontes[id];
  return f ? f.rotulo : id;
}

/* ---------------- estado da interface ---------------- */
var receitasEspeciais = [];   // linhas da seção 5
var ultimoResultado = null;   // último cenário calculado (para o relatório)
var ultimaTrajetoria = null;
var modosTributo = { pisCofins:'VALUE', icms:'VALUE', iss:'VALUE', ipi:'VALUE' };
var purchaseCreditMode = 'SIMPLE';   // padrão sempre simples
var currentRevenueMode = 'SIMPLE';   // situação atual: SIMPLE | DETAILED
var receitasAtuaisDetalhadas = [];   // linhas do MODELO ANTERIOR (schema 1)
// schema 2 = tabela unificada; schema 1 = modelo separado dos clientes antigos.
// Sessão nova já nasce em 2; cliente antigo carregado permanece em 1 até que o
// próprio usuário conclua a consolidação manual.
var revenueDetailSchemaVersion = 2;
var receitasDetalhadasUnificadas = [];   // linhas do modelo unificado
var legadoDetalheBackup = null;          // cópia do modelo anterior, guardada na consolidação
var consolidacao = null;                 // rascunho da consolidação em andamento
var clienteEmModeloAnterior = false;     // liga o aviso de compatibilidade

/* Sprint 10.2.2 — PIS/Cofins e IRPJ/CSLL são SEMPRE informados separadamente.
   Na 10.2 o valor combinado antigo continuava sendo aceito indefinidamente, com
   um botão opcional para separar. Isso deixava um cliente rodar para sempre num
   modelo que já não é o da ferramenta. Agora o combinado não é mais uma forma
   válida de entrada: é apenas uma REFERÊNCIA do que estava salvo.

   Enquanto a migração não for confirmada, o cliente fica PENDENTE e a simulação
   é bloqueada (fail closed). O valor antigo não é apagado antes da confirmação e
   nunca é repartido por alíquota, metade ou qualquer proporção — a divisão é
   informação do usuário, não dedução da ferramenta. */
var pisCofinsPendenteLegado = false;   // aguardando a separação informada
var pisCofinsLegadoValor = 0;          // agregado antigo, só como referência
var pisCofinsLegadoAuditoria = null;   // { valor, periodicidade } após confirmar
var irpjCsllPendenteLegado = false;
var irpjCsllLegadoValor = 0;
var irpjCsllLegadoPeriodicidade = 'MENSAL';
var irpjCsllLegadoAuditoria = null;
var gruposCompras = [];              // linhas do modo detalhado

var LS_NS = 'fiscalcode_lucroreal_v1';

function lerStore(){
  try { return JSON.parse(localStorage.getItem(LS_NS)) || { clientes:{} }; }
  catch(e){ return { clientes:{} }; }
}
function gravarStore(s){
  try { localStorage.setItem(LS_NS, JSON.stringify(s)); return true; }
  catch(e){ return false; }
}

function flash(msg, erro){
  var m = $('wsMsg');
  m.textContent = msg;
  m.className = 'ws-msg' + (erro ? ' err' : '');
  if(flash._t) clearTimeout(flash._t);
  flash._t = setTimeout(function(){ m.textContent=''; }, 5000);
}

/* ---------------- coleta dos dados da tela ---------------- */
/** lê os tributos atuais da tela no formato de ENTRADA (com modo), antes da normalização */
/** valor de PIS e Cofins do modo VALUE, já com a regra de compatibilidade */
function valoresPisCofinsValue(){
  /* A verdade é sempre a dupla PIS + Cofins. Mesmo com migração pendente, o
     agregado antigo NÃO volta ao cálculo: ele é referência, e a simulação fica
     bloqueada até que o usuário informe os dois valores. */
  var pis = valMoeda('atualPis'), cof = valMoeda('atualCofins');
  return { pis: pis, cofins: cof, total: pis + cof, combinado: false,
           pendente: pisCofinsPendenteLegado, legado: pisCofinsLegadoValor };
}

/** os dois campos foram efetivamente preenchidos pelo usuário? */
function pisCofinsInformados(){
  return String($('atualPis').value).trim() !== '' && String($('atualCofins').value).trim() !== '';
}

function coletarEntradasTributosAtuais(){
  var pc = valoresPisCofinsValue();
  var ativos = tributosAtivosDaTela();

  /* Tributo fora do escopo do segmento entra no motor como ZERO, qualquer que
     seja o modo. Vale para VALUE e para RATE: se o campo não está na tela, nem
     o valor nem a dupla base/alíquota podem produzir imposto.

     O que estiver digitado NÃO é apagado do formulário — o usuário pode ter
     informado o IPI em Indústria e só estar olhando Serviços por um momento.
     Ao reativar o tributo, o valor volta a participar exatamente como estava.
     A marca inativoNoSegmento acompanha a entrada para que a memória e os
     relatórios digam por que aquele tributo está zerado. */
  function entrada(id, campoValor, campoBase, campoAliq){
    if(!ativos[id]){
      return { modo:'VALUE', valor:0, base:0, aliquota:0, inativoNoSegmento:true,
               valorPreservado: valMoeda(campoValor),
               basePreservada: valMoeda(campoBase), aliquotaPreservada: valNum(campoAliq),
               modoPreservado: modosTributo[id] };
    }
    return { modo: modosTributo[id], valor: valMoeda(campoValor),
             base: valMoeda(campoBase), aliquota: valNum(campoAliq) };
  }

  return {
    pisCofins: {
      modo: modosTributo.pisCofins,
      // o motor recebe SEMPRE o agregado; os componentes viajam ao lado
      valor: pc.total,
      valorPis: pc.pis, valorCofins: pc.cofins, combinadoLegado: pc.combinado,
      pendenteMigracao: pc.pendente,
      pis:    { base: valMoeda('pisBase'),    aliquota: valNum('pisAliq') },
      cofins: { base: valMoeda('cofinsBase'), aliquota: valNum('cofinsAliq') }
    },
    icms: entrada('icms', 'atualIcms', 'icmsBase', 'icmsAliq'),
    iss:  entrada('iss',  'atualIss',  'issBase',  'issAliq'),
    ipi:  entrada('ipi',  'atualIpi',  'ipiBase',  'ipiAliq')
  };
}

/** marca no rastreio os tributos que ficaram fora por causa do segmento */
function marcarInativosNoRastreio(detalhe, entradas){
  ['icms','iss','ipi'].forEach(function(k){
    if(entradas[k] && entradas[k].inativoNoSegmento && detalhe[k]){
      detalhe[k].inativoNoSegmento = true;
      detalhe[k].valorPreservado = entradas[k].valorPreservado;
    }
  });
  return detalhe;
}

function modeloUnificadoAtivo(){
  return currentRevenueMode === 'DETAILED' && revenueDetailSchemaVersion === UNIFICADO_SCHEMA;
}

function coletarDados(){
  var entradas = coletarEntradasTributosAtuais();
  var norm = normalizeCurrentTaxes(entradas);
  // Três fontes possíveis, mutuamente exclusivas — nunca somadas:
  //   SIMPLE                      -> campos gerais
  //   DETAILED schema 2           -> tabela unificada
  //   DETAILED schema 1 (legado)  -> tabela separada da situação atual
  var unificado = modeloUnificadoAtivo();
  var detAtual = null;
  if(unificado) detAtual = normalizeUnifiedRevenue(receitasDetalhadasUnificadas, FISCAL_RULES);
  else if(currentRevenueMode === 'DETAILED') detAtual = normalizeDetailedCurrentRevenue(receitasAtuaisDetalhadas);
  var valoresAtuais = detAtual
    ? { pisCofins: detAtual.pisCofins, icms: detAtual.icms, iss: detAtual.iss, ipi: detAtual.ipi }
    : norm.valores;
  return {
    empresa: $('empresa').value.trim(),
    cnpj: $('cnpj').value.trim(),
    segmento: $('segmento').value,
    faturamento: valMoeda('faturamento'),
    compras: valMoeda('compras'),
    pctCreditavel: valNum('pctCreditavel'),
    pctB2B: valNum('pctB2B'),
    // No modelo unificado a exportação vem da própria linha (tratamento EXPORTACAO).
    // O campo simples continua salvo, mas não participa do cálculo.
    pctExportacao: unificado ? 0 : valNum('pctExportacao'),
    pctExportacaoInformado: valNum('pctExportacao'),
    // o motor recebe SEMPRE valores em reais; a origem fica em atualEntrada/atualDetalhe
    atual: valoresAtuais,
    atualEntrada: entradas,
    // enriquece a rastreabilidade do PIS/Cofins com os componentes informados.
    // A função pura normalizeCurrentTaxes() continua intocada: no modo VALUE ela
    // devolve pis/cofins nulos e é aqui, na apresentação, que a separação entra.
    // No DETAILED a supressão por segmento NÃO se aplica: cada operação declara
    // os próprios tributos e o segmento principal é apenas organizacional.
    atualDetalhe: detAtual ? buildDetailedCurrentTaxTrace(detAtual)
                           : marcarInativosNoRastreio(enriquecerPisCofins(norm.detalhe, entradas), entradas),
    tributosAtivos: detAtual ? { pisCofins:true, icms:true, iss:true, ipi:true } : tributosAtivosDaTela(),
    currentRevenueMode: currentRevenueMode,
    revenueDetailSchemaVersion: revenueDetailSchemaVersion,
    revenueModelUnified: unificado,
    atualDetalhado: detAtual,
    irpjEntrada: normalizarIrpjCsll(),
    complementar: {
      irpjCsll: irpjCsllMensal(),
      encargosPatronais: valMoeda('encargosPatronais'),
      encargosProLabore: valMoeda('encargosProLabore')
    },
    // No modelo unificado a fonte é EXCLUSIVAMENTE a tabela unificada; as linhas
    // antigas de tratamento específico ficam preservadas, mas fora do cálculo.
    receitasEspeciais: unificado ? unifiedToEngineRevenue(detAtual) : receitasEspeciais.map(function(l){
      return { descricao:l.descricao, valor:parseBR(l.valor), tratamento:l.tratamento, pctCustom:num(l.pctCustom) };
    }),
    impostoSeletivo: {
      sujeita: $('isSujeita').checked,
      categoria: $('isCategoria').value,
      base: valMoeda('isBase'),
      usarCustom: $('isUsarCustom').checked,
      aliquota: valNum('isAliquota')
    },
    ipiResidual: { ativo: $('ipiResidualAtivo').checked, valor: valMoeda('ipiResidualValor') },
    // A redução geral incide sobre a receita integral residual. No modelo
    // unificado não existe residual: cada linha traz o próprio tratamento.
    reducaoGeral: unificado ? 0 : valNum('reducaoGeral'),
    reducaoGeralInformada: valNum('reducaoGeral'),
    purchaseCreditMode: purchaseCreditMode,
    gruposCompras: gruposCompras.map(function(g){
      // valores crus: o motor precisa distinguir campo VAZIO de zero informado
      return { descricao:g.descricao, valor:parseBR(g.valor), tipo:g.tipo,
               reducao:g.reducao, fatorIbs:g.fatorIbs, fatorCbs:g.fatorCbs,
               aliquotaCreditoIbs:g.aliquotaCreditoIbs, aliquotaCreditoCbs:g.aliquotaCreditoCbs };
    })
  };
}

/* ---------------- seção 5: receitas com tratamento específico ---------------- */
function renderTratamentos(){
  var box = $('trtLista');
  box.innerHTML = receitasEspeciais.map(function(l,i){
    var t = null;
    FISCAL_RULES.tratamentosReceita.forEach(function(x){ if(x.id===l.tratamento) t = x; });
    var mostraPct = t && t.pctEditavel;
    var opcoes = FISCAL_RULES.tratamentosReceita.map(function(x){
      return '<option value="'+x.id+'"'+(x.id===l.tratamento?' selected':'')+'>'+esc(x.rotulo)+'</option>';
    }).join('');
    // aviso discreto de possível duplicidade com o campo simplificado de exportações
    var dup = (l.tratamento === 'EXPORTACAO' && valNum('pctExportacao') > 0)
      ? '<div class="trt-dup" data-dup="'+i+'">Já existe exportação informada no campo simplificado. '+
        'Certifique-se de que esta linha representa receita adicional e não o mesmo valor.</div>'
      : '';
    // regra de crédito do tratamento escolhido, visível na hora da escolha
    var regra = t ? (t.creditTreatment === 'PROPORTIONAL_REVERSAL'
        ? '<b>Anulação proporcional dos créditos.</b> ' : '<b>Mantém os créditos das aquisições.</b> ') : '';
    var ajuda = t && t.ajuda ? '<div class="trt-ajuda" data-ajuda="'+i+'">'+regra+esc(t.ajuda)+'</div>' : '';
    return '<div class="trt-row'+(mostraPct?' show-pct':'')+'" data-i="'+i+'">'+
      '<input type="text" class="trt-desc" placeholder="Descrição da receita" value="'+esc(l.descricao)+'">'+
      '<input type="text" class="trt-val" placeholder="0,00" inputmode="decimal" value="'+esc(l.valor)+'">'+
      '<select class="trt-trat">'+opcoes+'</select>'+
      '<div class="pctcell"><input type="number" class="trt-pct" placeholder="%" step="5" min="0" max="100" inputmode="decimal" value="'+esc(l.pctCustom)+'"></div>'+
      '<button class="del" type="button" title="Remover">&times;</button>'+
    '</div>' + ajuda + dup;
  }).join('');

  Array.prototype.forEach.call(box.querySelectorAll('.trt-row'), function(row){
    var i = +row.getAttribute('data-i');
    row.querySelector('.trt-desc').addEventListener('input', function(){ receitasEspeciais[i].descricao = this.value; });
    var vTrt = row.querySelector('.trt-val');
    ligarMoeda(vTrt);
    vTrt.addEventListener('input', function(){ receitasEspeciais[i].valor = this.value; totalTratamentos(); });
    row.querySelector('.trt-trat').addEventListener('change', function(){ receitasEspeciais[i].tratamento = this.value; renderTratamentos(); });
    var pct = row.querySelector('.trt-pct');
    if(pct) pct.addEventListener('input', function(){ receitasEspeciais[i].pctCustom = this.value; });
    row.querySelector('.del').addEventListener('click', function(){ receitasEspeciais.splice(i,1); renderTratamentos(); });
  });
  montarSeletoresNa(box);
  totalTratamentos();
}

function totalTratamentos(){
  var soma = receitasEspeciais.reduce(function(s,l){ return s + Math.max(0, parseBR(l.valor)); }, 0);
  $('trtTot').textContent = money(soma);

  var V = validarClassificacaoAtual();
  var w = $('trtWarn');
  if(!V.valido){
    w.className = 'tot-warn on erro';
    w.innerHTML = '<b>' + esc(V.mensagem) + '</b><br>' +
      'Faturamento: ' + money(V.faturamento) + ' · Exportações pelo campo simplificado: ' + money(V.exportacaoModoSimples) +
      ' · Receitas com tratamento específico: ' + money(V.somaReceitasEspeciais) +
      ' · Total classificado: ' + money(V.receitaClassificada) + '. A simulação fica bloqueada até o ajuste.';
  } else if(V.possivelDuplicidadeExportacao){
    w.className = 'tot-warn on';
    w.innerHTML = 'Há exportação informada no <b>campo simplificado</b> (' + money(V.exportacaoModoSimples) +
      ') e também em ' + V.linhasExportacao + ' linha(s) de tratamento específico. As duas somam ' +
      money(V.receitaClassificada) + ' e cabem no faturamento, mas confirme que não é o mesmo valor lançado duas vezes.';
  } else {
    w.className = 'tot-warn';
    w.innerHTML = '';
  }
  return V;
}

/* ---------------- modelo unificado de receitas (schema 2) ---------------- */

/** linha nova nasce em INTEGRAL porque isso representa explicitamente a
    tributação integral — não é benefício presumido. Linhas trazidas de um
    modelo anterior NUNCA usam esse padrão: ficam sem tratamento. */
function novaLinhaUnificada(){
  return { descricao:'', natureza:'comercio', faturamento:'', pis:'', cofins:'', icms:'', iss:'', ipi:'',
           tratamentoReforma:'INTEGRAL', pctCustom:'' };
}

/** PIS e Cofins de uma linha, respeitando linhas salvas no modelo combinado.
    Linha antiga traz só pisCofins e não há como saber a divisão: o agregado é
    preservado e a linha fica marcada para revisão. Nada é repartido. */
/** linhas de PIS e Cofins de UMA operação, no formato pedido pelo chamador.
    Linha combinada devolve uma linha só, sem tentar separar. */
function linhasPisCofinsDaOperacao(l, abre, meio, fecha){
  var pc = pisCofinsDaLinha(l);
  if(pc.combinadoLegado){
    return abre + 'PIS e Cofins (valor combinado)' + meio + money(pc.total) + fecha;
  }
  return abre + 'PIS' + meio + money(pc.pis) + fecha +
         abre + 'Cofins' + meio + money(pc.cofins) + fecha;
}

/** mesma informação em texto corrido */
function textoPisCofinsDaOperacao(l){
  var pc = pisCofinsDaLinha(l);
  return pc.combinadoLegado
    ? ('PIS e Cofins (valor combinado) ' + money(pc.total))
    : ('PIS ' + money(pc.pis) + ' · Cofins ' + money(pc.cofins));
}

/** a linha já traz PIS e Cofins separados? Única fonte dessa decisão. */
function linhaTemPisCofinsSeparado(l){
  if(!l) return false;
  return (l.pis !== undefined && l.pis !== null) || (l.cofins !== undefined && l.cofins !== null);
}

function pisCofinsDaLinha(l){
  var temSeparado = linhaTemPisCofinsSeparado(l);
  if(!temSeparado && l.pisCofins !== undefined && l.pisCofins !== null){
    var comb = Math.max(0, parseBR(l.pisCofins));
    return { pis: null, cofins: null, total: comb, combinadoLegado: true };
  }
  var pis = Math.max(0, parseBR(l.pis)), cof = Math.max(0, parseBR(l.cofins));
  return { pis: pis, cofins: cof, total: pis + cof, combinadoLegado: false };
}

function opcoesNatureza(sel){
  return NATUREZAS_RECEITA.map(function(n){
    return '<option value="'+n.id+'"'+(n.id===sel?' selected':'')+'>'+esc(n.rotulo)+'</option>';
  }).join('');
}
function opcoesTratamento(sel, comVazio){
  var h = comVazio ? '<option value=""'+(sel?'':' selected')+'>Selecione / revise</option>' : '';
  return h + FISCAL_RULES.tratamentosReceita.map(function(t){
    return '<option value="'+t.id+'"'+(t.id===sel?' selected':'')+'>'+esc(t.rotulo)+'</option>';
  }).join('');
}

/** desenha um cartão por operação. Os dois blocos internos (situação atual e
    Reforma) ficam lado a lado no desktop e empilhados no mobile. */
function cartaoUnificado(l, i, pref, comVazio){
  var t = tratamentoPorId(l.tratamentoReforma, FISCAL_RULES);
  var pendente = !t;
  var mostraPct = t && t.pctEditavel;
  var h = '<div class="uni-op'+(pendente?' uni-pend':'')+'" data-i="'+i+'">';
  h += '<div class="uni-top">'+
    '<div class="uni-f uni-desc"><label>Descrição</label>'+
      '<input type="text" class="'+pref+'-desc" placeholder="Ex.: Mercadoria com benefício de ICMS" value="'+esc(l.descricao)+'"></div>'+
    '<div class="uni-f"><label>Natureza</label><select class="sel '+pref+'-nat">'+opcoesNatureza(l.natureza||'outros')+'</select></div>'+
    '<div class="uni-f"><label>Faturamento mensal</label>'+
      '<div class="inp"><span class="pre">R$</span><input type="text" class="has-pre '+pref+'-fat" placeholder="0,00" inputmode="decimal" value="'+esc(l.faturamento)+'"></div></div>'+
    '<button class="del '+pref+'-del" type="button" title="Remover operação" aria-label="Remover operação"><span aria-hidden="true">&times;</span><span class="uni-del-t">Remover operação</span></button>'+
  '</div>';

  h += '<div class="uni-cols">';
  h += '<div class="uni-bloco"><div class="uni-bh">Situação atual</div><div class="uni-g4">'+
    [['pis','PIS'],['cofins','Cofins'],['icms','ICMS'],['iss','ISS'],['ipi','IPI']].map(function(c){
      return '<div class="uni-f"><label>'+c[1]+' em R$</label>'+
        '<div class="inp"><span class="pre">R$</span><input type="text" class="has-pre '+pref+'-'+c[0]+'" placeholder="0,00" inputmode="decimal" value="'+esc(l[c[0]])+'"></div></div>';
    }).join('')+'</div></div>';

  h += '<div class="uni-bloco reforma"><div class="uni-bh">Reforma</div>'+
    '<div class="uni-f"><label>Tratamento IBS/CBS</label>'+
      '<select class="sel '+pref+'-trat">'+opcoesTratamento(l.tratamentoReforma, comVazio)+'</select></div>'+
    '<div class="uni-f uni-pct'+(mostraPct?'':' hidden')+'"><label>Redução personalizada</label>'+
      '<div class="inp"><input type="number" class="has-suf '+pref+'-pct" step="1" min="0" max="100" inputmode="decimal" value="'+esc(l.pctCustom)+'"><span class="suf">%</span></div></div>'+
    '<div class="uni-ajuda">'+ (t ? esc(t.ajuda) :
        'Escolha explicitamente como esta receita será tratada no IBS/CBS. O simulador não deduz o tratamento a partir dos tributos atuais.') +
    '</div></div>';
  h += '</div>';

  h += '<div class="uni-res" data-res="'+i+'"></div>';
  if(pisCofinsDaLinha(l).combinadoLegado){
    h += '<div class="op-pers" style="background:#fffdf8;border-color:var(--lr-line);color:#5a4310">' +
         '<b>Operação salva com PIS e Cofins em valor combinado de ' + money(pisCofinsDaLinha(l).total) + '.</b> ' +
         'Informe acima quanto corresponde ao PIS e quanto corresponde à Cofins para continuar. ' +
         'O valor anterior está preservado apenas como referência e o simulador não o reparte por conta própria.</div>';
  }
  h += '</div>';
  return h;
}

/** liga os eventos de um conjunto de cartões a uma lista de estado */
function ligarCartoesUnificados(caixaId, pref, lista, aoMudar, comVazio){
  var box = $(caixaId);
  Array.prototype.forEach.call(box.querySelectorAll('.uni-op'), function(row){
    var i = +row.getAttribute('data-i');
    row.querySelector('.'+pref+'-desc').addEventListener('input', function(){ lista[i].descricao = this.value; aoMudar(); });
    row.querySelector('.'+pref+'-nat').addEventListener('change', function(){ lista[i].natureza = this.value; });
    [['-fat','faturamento'],['-pis','pis'],['-cofins','cofins'],['-icms','icms'],['-iss','iss'],['-ipi','ipi']].forEach(function(par){
      var el = row.querySelector('.'+pref+par[0]);
      ligarMoeda(el);
      el.addEventListener('input', function(){ lista[i][par[1]] = this.value; aoMudar(); });
    });
    var sel = row.querySelector('.'+pref+'-trat');
    sel.addEventListener('change', function(){
      lista[i].tratamentoReforma = this.value;
      // redesenha só o necessário: ajuda do tratamento, campo de percentual e destaque
      var t = tratamentoPorId(this.value, FISCAL_RULES);
      var pct = row.querySelector('.uni-pct');
      pct.className = 'uni-f uni-pct' + (t && t.pctEditavel ? '' : ' hidden');
      row.querySelector('.uni-ajuda').textContent = t ? t.ajuda :
        'Escolha explicitamente como esta receita será tratada no IBS/CBS. O simulador não deduz o tratamento a partir dos tributos atuais.';
      row.className = 'uni-op' + (t ? '' : ' uni-pend');
      aoMudar();
    });
    var pc = row.querySelector('.'+pref+'-pct');
    if(pc) pc.addEventListener('input', function(){ lista[i].pctCustom = this.value; aoMudar(); });
    row.querySelector('.'+pref+'-del').addEventListener('click', function(){
      lista.splice(i,1); aoMudar(true);
    });
  });
}

function renderReceitasUnificadas(){
  var box = $('uniLista');
  box.innerHTML = receitasDetalhadasUnificadas.length
    ? receitasDetalhadasUnificadas.map(function(l,i){ return cartaoUnificado(l,i,'u',false); }).join('')
    : '<div class="uni-vazio">Nenhuma operação informada. Use <b>+ Adicionar operação</b> para detalhar a composição do faturamento.</div>';
  ligarCartoesUnificados('uniLista','u',receitasDetalhadasUnificadas, function(redesenhar){
    if(redesenhar === true) renderReceitasUnificadas(); else totalReceitasUnificadas();
  }, false);
  montarSeletoresNa(box);
  totalReceitasUnificadas();
}

/** resumo por linha, dois totalizadores e o fail closed do faturamento */
function totalReceitasUnificadas(){
  var det = normalizeUnifiedRevenue(receitasDetalhadasUnificadas, FISCAL_RULES);
  det.linhas.forEach(function(l,i){
    var cel = $('uniLista').querySelector('[data-res="'+i+'"]');
    if(!cel) return;
    cel.innerHTML =
      '<span><span class="rot">Tributos atuais da linha:</span> <b>' + money(l.tributos) + '</b></span>' +
      (l.cargaEfetiva == null ? '' :
        '<span><span class="rot">Carga efetiva dos tributos informados sobre a receita da linha:</span> <b>' + pctFmt(l.cargaEfetiva) + '</b></span>') +
      '<span><span class="rot">Tratamento Reforma:</span> <b>' + esc(l.tratamentoRotulo) +
        (l.pctCustom != null ? ' (' + pctFmt(l.pctCustom,0) + ')' : '') + '</b></span>';
  });
  $('uniTotais').innerHTML = totalizadoresUnificados(det);
  aplicarAvisoUnificado('uniWarn', det);
  return det;
}

/** dois blocos de conferência: soma dos valores e soma por tratamento */
function totalizadoresUnificados(det){
  function l(rot, val, forte){
    return '<div class="uni-tot-l'+(forte?' forte':'')+'"><span>'+rot+'</span><b>'+val+'</b></div>';
  }
  var n = det.linhas.length;
  var h = '<div class="uni-tot"><div class="uni-tot-h">Totais informados</div>';
  h += l('Faturamento detalhado', money(det.faturamentoDetalhado));
  if(det.linhasCombinadoLegado > 0){
    h += l('PIS/Cofins atual <span style="color:var(--muted);font-weight:600">· ' + det.linhasCombinadoLegado +
           (det.linhasCombinadoLegado === 1 ? ' linha combinada' : ' linhas combinadas') + '</span>', money(det.pisCofins));
  } else {
    h += l('PIS atual', money(det.pis));
    h += l('Cofins atual', money(det.cofins));
  }
  h += l('ICMS atual', money(det.icms));
  h += l('ISS atual', money(det.iss));
  h += l('IPI atual', money(det.ipi));
  h += l('Tributos atuais sobre consumo', money(det.totalTributos), true);
  h += l('Quantidade de operações', String(n) + (n === 1 ? ' operação' : ' operações'));
  h += '</div>';

  h += '<div class="uni-tot"><div class="uni-tot-h">Receita por tratamento na Reforma — apenas conferência</div>';
  if(det.porTratamento.length){
    det.porTratamento.forEach(function(t){
      h += l(esc(t.rotulo) + ' <span style="color:var(--muted);font-weight:600">· ' + t.operacoes +
             (t.operacoes === 1 ? ' operação' : ' operações') + '</span>', money(t.valor));
    });
  } else {
    h += '<div class="uni-tot-l"><span style="color:var(--muted)">Nenhuma operação com tratamento definido.</span><b></b></div>';
  }
  if(det.semTratamento > 0){
    h += l('<span style="color:#7d0016">Sem tratamento selecionado</span>',
           '<span style="color:#7d0016">' + det.semTratamento +
           (det.semTratamento === 1 ? ' operação' : ' operações') + '</span>');
  }
  h += '<div class="uni-tot-l" style="border-top:1px dotted var(--line);margin-top:4px;padding-top:8px">'+
       '<span style="color:var(--muted);font-size:.8rem">Soma das linhas por tratamento. Não é fórmula fiscal nova.</span><b></b></div>';
  h += '</div>';
  return h;
}

/** aviso de reconciliação, com as mesmas mensagens do fail closed */
function aplicarAvisoUnificado(alvoId, det){
  var V = validateDetailedCurrentRevenue({
    currentRevenueMode:'DETAILED', faturamento: valMoeda('faturamento'), atualDetalhado: det
  });
  var w = $(alvoId), partes = [];
  if(!V.valido){
    partes.push('<b>' + esc(V.mensagem) + '</b><br>Faturamento total: ' + money(V.faturamentoTotal) +
      ' · Faturamento detalhado: ' + money(V.faturamentoDetalhado) +
      ' · Diferença: ' + money(Math.abs(V.diferenca)) + '. A simulação fica bloqueada até o ajuste.');
  }
  if(det.semTratamento > 0){
    partes.push('<b>' + det.semTratamento + (det.semTratamento === 1 ? ' operação está' : ' operações estão') +
      ' sem tratamento de IBS/CBS.</b> Escolha o tratamento de cada linha antes de simular.');
  }
  w.className = 'tot-warn' + (partes.length ? ' on erro' : '');
  w.innerHTML = partes.join('<br><br>');
  return V;
}

/** bloqueio dedicado das linhas sem tratamento */
function mostrarBloqueioTratamento(V){
  $('bloqueioMsg').textContent = V.mensagem;
  $('bloqueioDet').innerHTML =
    'Operações sem tratamento: <b>' + V.pendentes + '</b><br><br>' +
    'Nenhum tratamento foi presumido. O simulador não deduz redução, isenção ou alíquota zero a partir dos ' +
    'tributos atuais informados na linha. Selecione o tratamento de cada operação e simule novamente.';
  $('bloqueio').className = 'bloqueio';
  $('resultado').className = '';
  document.body.classList.remove('previewing');
  ultimoResultado = null;
  ultimaTrajetoria = null;
}

/* ---------------- consolidação manual de cliente no modelo anterior ---------------- */

/** abre o rascunho. Os dados da situação atual pertencem inequivocamente àquela
    lista e podem ser pré-carregados; o tratamento da Reforma NÃO é adivinhado. */
function abrirConsolidacao(){
  consolidacao = {
    linhas: (receitasAtuaisDetalhadas || []).map(function(l){
      return { descricao:l.descricao||'', natureza:l.natureza||'outros', faturamento:l.faturamento||'',
               pisCofins:l.pisCofins||'', icms:l.icms||'', iss:l.iss||'', ipi:l.ipi||'',
               tratamentoReforma:'', pctCustom:'' };   // sem vínculo confirmado
    })
  };
  if(!consolidacao.linhas.length) consolidacao.linhas.push(novaLinhaUnificada());
  renderConsolidacao();
  sincronizarModoAtual();
  $('consolidaBox').scrollIntoView({ behavior:'smooth', block:'start' });
}

function renderConsolidacao(){
  if(!consolidacao) return;
  var ref = (receitasEspeciais || []).filter(function(l){ return parseBR(l.valor) > 0; });
  var expPct = valNum('pctExportacao');
  var h = '<div class="cons-ref"><div class="cons-ref-h">Tratamentos informados no modelo anterior — referência</div>';
  if(ref.length || expPct > 0){
    h += '<ul>';
    ref.forEach(function(l){
      var t = tratamentoPorId(l.tratamento, FISCAL_RULES);
      h += '<li>' + esc(l.descricao || '(sem descrição)') + ' — ' + money(parseBR(l.valor)) +
           ' — ' + esc(t ? t.rotulo : l.tratamento) + '</li>';
    });
    if(expPct > 0) h += '<li>Campo simplificado de exportações: ' + pctFmt(expPct,0) + ' do faturamento</li>';
    h += '</ul>';
    h += '<div class="help" style="margin-top:6px">Estas linhas não são casadas automaticamente com as operações acima. ' +
         'Não há como saber qual linha corresponde a qual: a escolha é sua.</div>';
  } else {
    h += '<div class="help">Este cliente não possui receitas com tratamento específico informadas no modelo anterior.</div>';
  }
  h += '</div>';
  $('consRef').innerHTML = h;

  $('consLista').innerHTML = consolidacao.linhas.map(function(l,i){ return cartaoUnificado(l,i,'c',true); }).join('');
  ligarCartoesUnificados('consLista','c',consolidacao.linhas, function(redesenhar){
    if(redesenhar === true) renderConsolidacao(); else totalConsolidacao();
  }, true);
  montarSeletoresNa($('consLista'));
  totalConsolidacao();
}

function totalConsolidacao(){
  if(!consolidacao) return null;
  var det = normalizeUnifiedRevenue(consolidacao.linhas, FISCAL_RULES);
  det.linhas.forEach(function(l,i){
    var cel = $('consLista').querySelector('[data-res="'+i+'"]');
    if(!cel) return;
    cel.innerHTML =
      '<span><span class="rot">Tributos atuais da linha:</span> <b>' + money(l.tributos) + '</b></span>' +
      (l.cargaEfetiva == null ? '' :
        '<span><span class="rot">Carga efetiva dos tributos informados sobre a receita da linha:</span> <b>' + pctFmt(l.cargaEfetiva) + '</b></span>') +
      '<span><span class="rot">Tratamento Reforma:</span> <b>' + esc(l.tratamentoRotulo) + '</b></span>';
  });
  $('consTotais').innerHTML = totalizadoresUnificados(det);
  var V = aplicarAvisoUnificado('consWarn', det);
  $('consConfirmar').disabled = !(V.valido && det.semTratamento === 0);
  return det;
}

/** só aqui o cliente passa para o schema 2. Os dados anteriores não são
    apagados: ficam guardados como backup interno de rastreabilidade. */
function confirmarConsolidacao(){
  var det = totalConsolidacao();
  if(!det) return;
  var V = validateDetailedCurrentRevenue({
    currentRevenueMode:'DETAILED', faturamento: valMoeda('faturamento'), atualDetalhado: det
  });
  if(!V.valido || det.semTratamento > 0){
    flash('Revise as operações antes de confirmar: o faturamento precisa fechar e toda linha precisa de tratamento.', true);
    return;
  }
  legadoDetalheBackup = {
    receitasAtuaisDetalhadas: (receitasAtuaisDetalhadas || []).map(function(l){ return JSON.parse(JSON.stringify(l)); }),
    receitasEspeciais: (receitasEspeciais || []).map(function(l){ return JSON.parse(JSON.stringify(l)); }),
    pctExportacao: $('pctExportacao').value,
    reducaoGeral: $('reducaoGeral').value,
    consolidadoEm: new Date().toISOString()
  };
  receitasDetalhadasUnificadas = consolidacao.linhas.map(function(l){ return JSON.parse(JSON.stringify(l)); });
  revenueDetailSchemaVersion = UNIFICADO_SCHEMA;
  consolidacao = null;
  renderReceitasUnificadas();
  sincronizarModoAtual();
  flash('Detalhamento consolidado no modelo unificado. Salve o cliente para gravar a mudança.');
  if(ultimoResultado) simular();
}

function cancelarConsolidacao(){
  consolidacao = null;
  sincronizarModoAtual();
  flash('Consolidação cancelada. O cliente continua no modelo anterior, com o cálculo preservado.');
}

/* ---------------- situação atual detalhada por linha de receita ---------------- */
function renderReceitasAtuais(){
  var box = $('ratLista');
  var opcoes = NATUREZAS_RECEITA.map(function(n){ return '<option value="'+n.id+'">'+esc(n.rotulo)+'</option>'; }).join('');
  box.innerHTML = receitasAtuaisDetalhadas.map(function(l,i){
    return '<div class="rat-row" data-i="'+i+'">'+
      '<input type="text" class="rat-desc" placeholder="Ex.: Mercadoria com benefício de ICMS" value="'+esc(l.descricao)+'">'+
      '<select class="rat-nat">'+opcoes+'</select>'+
      '<input type="text" class="rat-fat" placeholder="0,00" inputmode="decimal" value="'+esc(l.faturamento)+'">'+
      '<input type="text" class="rat-pis" placeholder="0,00" inputmode="decimal" value="'+esc(l.pisCofins)+'">'+
      '<input type="text" class="rat-icms" placeholder="0,00" inputmode="decimal" value="'+esc(l.icms)+'">'+
      '<input type="text" class="rat-iss" placeholder="0,00" inputmode="decimal" value="'+esc(l.iss)+'">'+
      '<input type="text" class="rat-ipi" placeholder="0,00" inputmode="decimal" value="'+esc(l.ipi)+'">'+
      '<button class="del" type="button" title="Remover">&times;</button>'+
      '<div class="rat-calc" data-calc="'+i+'"></div>'+
    '</div>';
  }).join('');

  Array.prototype.forEach.call(box.querySelectorAll('.rat-row'), function(row){
    var i = +row.getAttribute('data-i');
    row.querySelector('.rat-nat').value = receitasAtuaisDetalhadas[i].natureza || 'outros';
    row.querySelector('.rat-desc').addEventListener('input', function(){ receitasAtuaisDetalhadas[i].descricao = this.value; });
    row.querySelector('.rat-nat').addEventListener('change', function(){ receitasAtuaisDetalhadas[i].natureza = this.value; });
    [['.rat-fat','faturamento'],['.rat-pis','pisCofins'],['.rat-icms','icms'],['.rat-iss','iss'],['.rat-ipi','ipi']]
    .forEach(function(par){
      var el = row.querySelector(par[0]);
      ligarMoeda(el);
      el.addEventListener('input', function(){ receitasAtuaisDetalhadas[i][par[1]] = this.value; totalReceitasAtuais(); });
    });
    row.querySelector('.del').addEventListener('click', function(){ receitasAtuaisDetalhadas.splice(i,1); renderReceitasAtuais(); });
  });
  montarSeletoresNa(box);
  totalReceitasAtuais();
}

/** totais, carga efetiva por linha e aviso de divergência com o faturamento */
function totalReceitasAtuais(){
  var det = normalizeDetailedCurrentRevenue(receitasAtuaisDetalhadas);
  $('ratTotFat').textContent = money(det.faturamentoDetalhado);
  $('ratTotTrib').innerHTML = '<span>Tributos atuais somados</span><span>' + money(det.totalTributos) + '</span>' +
    '<span style="flex:1 1 100%;font-weight:600;color:var(--muted);font-size:.8rem">' +
    'PIS/Cofins ' + money(det.pisCofins) + ' · ICMS ' + money(det.icms) +
    ' · ISS ' + money(det.iss) + ' · IPI ' + money(det.ipi) + '</span>';

  det.linhas.forEach(function(l,i){
    var cell = $('ratLista').querySelector('[data-calc="'+i+'"]');
    if(!cell) return;
    cell.innerHTML = '<span>Tributos da linha</span><span>' + money(l.tributos) +
      (l.cargaEfetiva == null ? '' : ' · carga efetiva dos tributos informados sobre a receita da linha: ' + pctFmt(l.cargaEfetiva)) + '</span>';
  });

  var V = validateDetailedCurrentRevenue({
    currentRevenueMode: 'DETAILED',
    faturamento: valMoeda('faturamento'),
    atualDetalhado: det
  });
  var w = $('ratWarn');
  if(!V.valido){
    w.className = 'tot-warn on erro';
    w.innerHTML = '<b>' + esc(V.mensagem) + '</b><br>Faturamento total: ' + money(V.faturamentoTotal) +
      ' · Faturamento detalhado: ' + money(V.faturamentoDetalhado) +
      ' · Diferença: ' + money(Math.abs(V.diferenca)) + '. A simulação fica bloqueada até o ajuste.';
  } else {
    w.className = 'tot-warn';
    w.innerHTML = '';
  }
  return det;
}

/** liga/desliga o modo detalhado sem apagar nada de nenhum dos modelos.
    Três estados possíveis: SIMPLE, DETAILED unificado e DETAILED legado. */
function sincronizarModoAtual(){
  var det = currentRevenueMode === 'DETAILED';
  var uni = det && revenueDetailSchemaVersion === UNIFICADO_SCHEMA;
  var consolidando = det && !!consolidacao;

  $('unificadoBox').className   = 'field full' + (uni && !consolidando ? '' : ' hidden');
  $('consolidaBox').className   = 'field full' + (consolidando ? '' : ' hidden');
  $('atualDetalhadoBox').className = 'field full' + (det && !uni && !consolidando ? '' : ' hidden');

  $('toggleAtualDetalhado').textContent = det
    ? 'Usar modo simples' : 'Detalhar receitas e tratamentos por operação';
  $('toggleAtualDetalhado').setAttribute('aria-pressed', det ? 'true' : 'false');

  // campos gerais da situação atual: preservados, mas fora do cálculo
  ['f_pisCofins','f_icms','f_iss','f_ipi'].forEach(function(id){
    var el = $(id); if(!el) return;
    el.style.opacity = det ? '.5' : '';
    el.title = det ? 'No modo detalhado, estes valores não são usados no cálculo.' : '';
  });

  // exportação simplificada: no modelo unificado vem da própria linha
  var fe = $('f_pctExportacao');
  if(fe){
    fe.className = 'field' + (uni ? ' campo-inativo' : '');
    $('avisoExportacao').className = 'aviso-inativo' + (uni ? '' : ' hidden');
  }
  // redução geral: sem residual, não há onde aplicá-la
  var fr = $('f_reducaoGeral');
  if(fr){
    fr.className = 'field' + (uni ? ' campo-inativo' : '');
    $('avisoReducaoGeral').className = 'aviso-inativo' + (uni ? '' : ' hidden');
  }
  // seção de tratamentos separados: no modelo unificado não participa
  var br = $('boxReceitas');
  if(br){
    br.className = 'opcional' + (uni ? ' campo-inativo' : '');
    var av = $('avisoTratamentosSeparados');
    if(av) av.className = 'aviso-inativo' + (uni ? '' : ' hidden');
    if(uni) br.open = false;
  }

  if(uni && !consolidando) totalReceitasUnificadas();
  else if(consolidando) totalConsolidacao();
  else if(det) totalReceitasAtuais();
}

/* ---------------- modo avançado de compras (grupos de aquisição) ---------------- */

/** grupo SIMPLES salvo na Sprint 04 (com fatores) e ainda sem as alíquotas
    efetivas de crédito. Não se converte nada automaticamente: a semântica
    fiscal é diferente e o usuário precisa revisar. */
function precisaRevisaoLegado(g){
  if(!g || g.tipo !== 'SIMPLES') return false;
  var vazio = function(v){ return String(v == null ? '' : v).trim() === ''; };
  var temNovos  = !vazio(g.aliquotaCreditoIbs) || !vazio(g.aliquotaCreditoCbs);
  var temLegado = !vazio(g.fatorIbs) || !vazio(g.fatorCbs);
  return !temNovos && temLegado;
}

function renderGruposCompras(){
  var box = $('cmpLista');
  var tipos = FISCAL_RULES.compras.tipos;
  box.innerHTML = gruposCompras.map(function(g,i){
    var tipo = null;
    tipos.forEach(function(t){ if(t.id===g.tipo) tipo = t; });
    if(!tipo) tipo = tipos[0];
    var opcoes = tipos.map(function(t){
      return '<option value="'+t.id+'"'+(t.id===g.tipo?' selected':'')+'>'+esc(t.rotulo)+'</option>';
    }).join('');

    var extra = '', alertaLegado = '';
    if(tipo.pedeReducao){
      extra = '<div class="cmp-extra" data-extra="'+i+'">'+
        '<div><label>Redução da alíquota na aquisição</label>'+
        '<input type="number" class="cmp-red" step="5" min="0" max="100" placeholder="0,00" inputmode="decimal" value="'+esc(g.reducao)+'"></div>'+
        '</div>';
    } else if(tipo.pedeAliquotasCredito){
      // alíquota efetiva de crédito — NÃO é fração da alíquota-padrão
      extra = '<div class="cmp-extra" data-extra="'+i+'">'+
        '<div><label>Alíquota efetiva de crédito IBS</label>'+
        '<input type="number" class="cmp-aibs" step="0.01" min="0" max="100" placeholder="informe o %" inputmode="decimal" value="'+esc(g.aliquotaCreditoIbs)+'"></div>'+
        '<div><label>Alíquota efetiva de crédito CBS</label>'+
        '<input type="number" class="cmp-acbs" step="0.01" min="0" max="100" placeholder="informe o %" inputmode="decimal" value="'+esc(g.aliquotaCreditoCbs)+'"></div>'+
        '</div>';
      if(precisaRevisaoLegado(g)){
        alertaLegado = '<div class="trt-dup" data-legado="'+i+'">Este grupo do Simples foi salvo no modelo anterior de fatores. '+
          'Revise e informe as novas alíquotas efetivas de crédito de IBS e CBS.</div>';
      }
    } else if(tipo.pedeFatores){
      extra = '<div class="cmp-extra" data-extra="'+i+'">'+
        '<div><label>Fator estimado do crédito de IBS sobre a alíquota-padrão</label>'+
        '<input type="number" class="cmp-fibs" step="5" min="0" max="100" placeholder="informe o %" inputmode="decimal" value="'+esc(g.fatorIbs)+'"></div>'+
        '<div><label>Fator estimado do crédito de CBS sobre a alíquota-padrão</label>'+
        '<input type="number" class="cmp-fcbs" step="5" min="0" max="100" placeholder="informe o %" inputmode="decimal" value="'+esc(g.fatorCbs)+'"></div>'+
        '</div>';
    }

    // classificação é sempre do usuário; a regra de cálculo é que pode vir de norma
    var selo = '<span class="st st-USER_INPUT" title="A escolha do tipo desta aquisição foi feita por você.">Classificação: informada por você</span> ' +
               (tipo.ruleStatus === 'LEGAL_FIXED'
                 ? '<span class="st st-LEGAL_FIXED">'+esc(tipo.ruleRotulo)+'</span>'
                 : '<span class="st st-USER_CUSTOM">'+esc(tipo.ruleRotulo)+'</span>');
    var ajuda = '<div class="cmp-ajuda" data-ajuda="'+i+'">'+selo+' '+esc(tipo.ajuda)+'</div>';

    return '<div class="cmp-row" data-i="'+i+'">'+
      '<input type="text" class="cmp-desc" placeholder="Descrição da aquisição" value="'+esc(g.descricao)+'">'+
      '<input type="text" class="cmp-val" placeholder="0,00" inputmode="decimal" value="'+esc(g.valor)+'">'+
      '<select class="cmp-tipo">'+opcoes+'</select>'+
      '<button class="del" type="button" title="Remover">&times;</button>'+
    '</div>' + extra + alertaLegado + ajuda + '<div class="cmp-cred" data-cred="'+i+'"></div>';
  }).join('');

  Array.prototype.forEach.call(box.querySelectorAll('.cmp-row'), function(row){
    var i = +row.getAttribute('data-i');
    row.querySelector('.cmp-desc').addEventListener('input', function(){ gruposCompras[i].descricao = this.value; });
    var vCmp = row.querySelector('.cmp-val');
    ligarMoeda(vCmp);
    vCmp.addEventListener('input', function(){ gruposCompras[i].valor = this.value; totalGruposCompras(); });
    row.querySelector('.cmp-tipo').addEventListener('change', function(){ gruposCompras[i].tipo = this.value; renderGruposCompras(); });
    row.querySelector('.del').addEventListener('click', function(){ gruposCompras.splice(i,1); renderGruposCompras(); });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.cmp-extra'), function(bloco){
    var i = +bloco.getAttribute('data-extra');
    var red = bloco.querySelector('.cmp-red');
    if(red) red.addEventListener('input', function(){ gruposCompras[i].reducao = this.value; totalGruposCompras(); });
    var fi = bloco.querySelector('.cmp-fibs');
    if(fi) fi.addEventListener('input', function(){ gruposCompras[i].fatorIbs = this.value; totalGruposCompras(); });
    var fc = bloco.querySelector('.cmp-fcbs');
    if(fc) fc.addEventListener('input', function(){ gruposCompras[i].fatorCbs = this.value; totalGruposCompras(); });
    // alíquotas efetivas de crédito do Simples: ao informar, o alerta de revisão some
    var ai = bloco.querySelector('.cmp-aibs');
    if(ai) ai.addEventListener('input', function(){
      gruposCompras[i].aliquotaCreditoIbs = this.value;
      atualizarAlertaLegado(i);
      totalGruposCompras();
    });
    var ac = bloco.querySelector('.cmp-acbs');
    if(ac) ac.addEventListener('input', function(){
      gruposCompras[i].aliquotaCreditoCbs = this.value;
      atualizarAlertaLegado(i);
      totalGruposCompras();
    });
  });
  montarSeletoresNa(box);
  totalGruposCompras();
}

/** remove o alerta de revisão assim que a alíquota efetiva é informada */
function atualizarAlertaLegado(i){
  var alerta = $('cmpLista').querySelector('[data-legado="'+i+'"]');
  if(alerta && !precisaRevisaoLegado(gruposCompras[i])) alerta.parentNode.removeChild(alerta);
}

/** totais, aviso de não classificadas e prévia do crédito de cada grupo */
function totalGruposCompras(){
  var V = validatePurchaseClassification(coletarDadosCompras());
  $('cmpTot').textContent = money(V.somaComprasDetalhadas);
  $('cmpNaoClass').textContent = money(V.comprasNaoClassificadas);
  $('cmpNaoClassBox').className = 'tot-soft' + (V.comprasNaoClassificadas > 0.005 ? '' : ' zerado');

  var w = $('cmpWarn');
  if(!V.valido){
    w.className = 'tot-warn on erro';
    w.innerHTML = '<b>' + esc(V.mensagem) + '</b><br>Compras totais: ' + money(V.totalCompras) +
      ' · Grupos informados: ' + money(V.somaComprasDetalhadas) + '. A simulação fica bloqueada até o ajuste.';
  } else if(V.comprasNaoClassificadas > 0.005){
    w.className = 'tot-warn on';
    w.innerHTML = 'Existem compras ainda não classificadas. No modo detalhado, apenas os grupos informados geram crédito.';
  } else {
    w.className = 'tot-warn';
    w.innerHTML = '';
  }

  // prévia do crédito por grupo, com as alíquotas do ano selecionado
  var P = coletarDados();
  if(P.purchaseCreditMode !== 'DETAILED') return V;
  var det = calculateDetailedPurchaseCredits(P, FISCAL_RULES, $('ano').value);
  var visiveis = det.linhas;
  var idx = 0;
  gruposCompras.forEach(function(g,i){
    var cell = $('cmpLista').querySelector('[data-cred="'+i+'"]');
    if(!cell) return;
    if(parseBR(g.valor) <= 0){ cell.innerHTML = '<span>Crédito estimado</span><span>—</span>'; return; }
    var l = visiveis[idx++];
    if(!l){ cell.innerHTML = ''; return; }
    var aviso = '';
    if(l.legacySimpleCreditNeedsReview){
      aviso = ' <span style="color:#8a6100">· modelo anterior de fatores: crédito zero até a revisão</span>';
    } else if(l.semFatorInformado){
      aviso = l.tipo === 'SIMPLES'
        ? ' <span style="color:#8a6100">· alíquotas efetivas de crédito do Simples não informadas: crédito considerado zero neste grupo</span>'
        : ' <span style="color:#8a6100">· fatores não informados: crédito zero</span>';
    }
    cell.innerHTML = '<span>Crédito estimado em '+$('ano').value+'</span>'+
      '<span>IBS '+money(l.creditoIbs)+' · CBS '+money(l.creditoCbs)+' · Total '+money(l.creditoTotal)+aviso+'</span>';
  });
  return V;
}

/** subconjunto de dados suficiente para validar as compras */
function coletarDadosCompras(){
  return {
    compras: valMoeda('compras'),
    purchaseCreditMode: purchaseCreditMode,
    gruposCompras: gruposCompras.map(function(g){
      // valores crus: o motor precisa distinguir campo VAZIO de zero informado
      return { descricao:g.descricao, valor:parseBR(g.valor), tipo:g.tipo,
               reducao:g.reducao, fatorIbs:g.fatorIbs, fatorCbs:g.fatorCbs,
               aliquotaCreditoIbs:g.aliquotaCreditoIbs, aliquotaCreditoCbs:g.aliquotaCreditoCbs };
    })
  };
}

/** liga/desliga o modo detalhado */
function sincronizarModoCompras(){
  var detalhado = purchaseCreditMode === 'DETAILED';
  $('comprasDetalhadas').className = 'field full' + (detalhado ? '' : ' hidden');
  $('toggleCompras').textContent = detalhado ? 'Voltar à estimativa simplificada' : 'Detalhar compras e créditos';
  $('toggleCompras').setAttribute('aria-pressed', detalhado ? 'true' : 'false');
  if(detalhado) totalGruposCompras();
}

/** roda a validação com os dados atuais da tela.
    ATENÇÃO: faturamento é campo monetário mascarado. Lê-lo com valNum() fazia
    parseFloat("150.000,00") parar no segundo ponto e devolver 150, acusando
    excesso de receita classificada que não existia. Campo de moeda só entra
    por valMoeda()/parseBR(). */
function validarClassificacaoAtual(){
  return validateRevenueClassification({
    faturamento: valMoeda('faturamento'),
    pctExportacao: valNum('pctExportacao'),
    receitasEspeciais: receitasEspeciais.map(function(l){
      return { valor: parseBR(l.valor), tratamento: l.tratamento };
    })
  });
}

/** aviso forte de bloqueio; limpa qualquer resultado/relatório anterior */
function mostrarBloqueio(V){
  $('bloqueioMsg').textContent = V.mensagem;
  $('bloqueioDet').innerHTML =
    'Faturamento médio mensal: <b>' + money(V.faturamento) + '</b><br>' +
    'Exportações pelo campo simplificado: <b>' + money(V.exportacaoModoSimples) + '</b><br>' +
    'Receitas com tratamento específico: <b>' + money(V.somaReceitasEspeciais) + '</b><br>' +
    'Receita classificada: <b>' + money(V.receitaClassificada) + '</b> — excesso de <b>' + money(V.excesso) + '</b><br><br>' +
    'Nenhum valor foi cortado, rateado ou ajustado automaticamente. Corrija as receitas e simule novamente.';
  $('bloqueio').className = 'bloqueio';
  // nada de resultado ou relatório antigo permanecer na tela
  $('resultado').className = '';
  document.body.classList.remove('previewing');
  ultimoResultado = null;
  ultimaTrajetoria = null;
}
/** bloqueio do faturamento atual detalhado */
function mostrarBloqueioReceitaAtual(V){
  $('bloqueioMsg').textContent = V.mensagem;
  $('bloqueioDet').innerHTML =
    'Faturamento total informado: <b>' + money(V.faturamentoTotal) + '</b><br>' +
    'Soma das linhas detalhadas: <b>' + money(V.faturamentoDetalhado) + '</b><br>' +
    'Diferença: <b>' + money(Math.abs(V.diferenca)) + '</b><br><br>' +
    'Nenhuma linha residual foi criada e nenhum valor foi rateado. Ajuste as linhas ou o faturamento total e simule novamente.';
  $('bloqueio').className = 'bloqueio';
  $('resultado').className = '';
  document.body.classList.remove('previewing');
  ultimoResultado = null;
  ultimaTrajetoria = null;
}

/** bloqueio específico das compras detalhadas */
function mostrarBloqueioCompras(V){
  $('bloqueioMsg').textContent = V.mensagem;
  $('bloqueioDet').innerHTML =
    'Compras e insumos médios mensais: <b>' + money(V.totalCompras) + '</b><br>' +
    'Soma dos grupos de compras informados: <b>' + money(V.somaComprasDetalhadas) + '</b><br>' +
    'Excesso: <b>' + money(V.excesso) + '</b><br><br>' +
    'Nenhum valor foi cortado ou rateado automaticamente. Ajuste os grupos ou o total de compras e simule novamente.';
  $('bloqueio').className = 'bloqueio';
  $('resultado').className = '';
  document.body.classList.remove('previewing');
  ultimoResultado = null;
  ultimaTrajetoria = null;
}

/* =====================================================================
   FAIL CLOSED DAS MIGRAÇÕES PENDENTES
   ---------------------------------------------------------------------
   Enquanto um agregado antigo não for separado, o cenário não é simulável:
   continuar usando o combinado em silêncio foi exatamente o comportamento
   que esta Sprint eliminou.

   O PIS/Cofins legado só bloqueia no fluxo SIMPLE em modo VALUE, que é o
   único lugar onde aquele agregado seria lido. No DETAILED os tributos vêm
   das operações, e no RATE a separação já existe nas bases e alíquotas.
   O IRPJ/CSLL bloqueia sempre, porque a carga completa o usa em qualquer modo.
   ===================================================================== */
function validarMigracoesPendentes(P){
  var pendentes = [];
  var pcRelevante = (P.currentRevenueMode !== 'DETAILED') && (modosTributo.pisCofins !== 'RATE');
  if(pisCofinsPendenteLegado && pcRelevante){
    pendentes.push({ rotulo:'PIS e Cofins', valor:pisCofinsLegadoValor,
                     mensagem:'Revise a separação de PIS e Cofins antes de simular.',
                     ancora:'atualPis' });
  }
  if(irpjCsllPendenteLegado){
    pendentes.push({ rotulo:'IRPJ e CSLL', valor:irpjCsllLegadoValor,
                     mensagem:'Revise a separação de IRPJ e CSLL antes de simular.',
                     ancora:'irpj' });
  }
  return { valido: pendentes.length === 0, pendentes: pendentes };
}

function mostrarBloqueioMigracao(V){
  $('bloqueioMsg').textContent = V.pendentes.map(function(x){ return x.mensagem; }).join(' ');
  $('bloqueioDet').innerHTML =
    V.pendentes.map(function(x){
      return 'Este cliente foi salvo com <b>' + esc(x.rotulo) + '</b> em valor combinado de <b>' +
             money(x.valor) + '</b>. Informe quanto corresponde a cada tributo nos campos da seção correspondente.';
    }).join('<br><br>') +
    '<br><br>O valor anterior não foi apagado e continua visível como referência. ' +
    'O simulador não divide esse total automaticamente: a repartição é informação da empresa, não uma dedução da ferramenta.';
  $('bloqueio').className = 'bloqueio';
  $('resultado').className = '';
  document.body.classList.remove('previewing');
  ultimoResultado = null;
  ultimaTrajetoria = null;
  var alvo = $(V.pendentes[0].ancora);
  if(alvo) alvo.focus();
}

/** linhas unificadas que ainda guardam PIS e Cofins somados */
function validarLinhasCombinadas(P){
  var d = P.atualDetalhado;
  var n = (d && d.origem === 'DETAILED_UNIFIED') ? (d.linhasCombinadoLegado || 0) : 0;
  return { valido: n === 0, linhas: n, total: d ? d.pisCofins : 0 };
}

function mostrarBloqueioLinhasCombinadas(V){
  $('bloqueioMsg').textContent = 'Revise a separação de PIS e Cofins antes de simular.';
  $('bloqueioDet').innerHTML =
    '<b>' + V.linhas + (V.linhas === 1 ? ' operação foi salva' : ' operações foram salvas') +
    '</b> com PIS e Cofins em valor combinado. Informe, em cada uma delas, quanto corresponde ao PIS e ' +
    'quanto corresponde à Cofins.<br><br>O valor anterior de cada operação continua visível como referência e ' +
    'não foi apagado. O simulador não divide esse total automaticamente: a repartição é informação da empresa.';
  $('bloqueio').className = 'bloqueio';
  $('resultado').className = '';
  document.body.classList.remove('previewing');
  ultimoResultado = null;
  ultimaTrajetoria = null;
}

function limparBloqueio(){
  $('bloqueio').className = 'bloqueio hidden';
  $('bloqueioMsg').textContent = '';
  $('bloqueioDet').innerHTML = '';
}

/* ---------------- seção 6: Imposto Seletivo ---------------- */
function montarCategoriasIS(){
  $('isCategoria').innerHTML = FISCAL_RULES.impostoSeletivo.categorias.map(function(c){
    return '<option value="'+c.id+'">'+esc(c.rotulo)+'</option>';
  }).join('');
  reconstruirOpcoesSeletor($('isCategoria'));
  atualizarAjudaIS();
}
function atualizarAjudaIS(){
  var id = $('isCategoria').value, cat = null;
  FISCAL_RULES.impostoSeletivo.categorias.forEach(function(c){ if(c.id===id) cat = c; });
  var h = $('isCatHelp');
  if(cat && cat.limiteMaximo){
    h.innerHTML = 'Há limite legal máximo de <b>' + pctFmt(cat.limiteMaximo.valor) + '</b> registrado para esta categoria (' +
      esc(rotuloFonte(cat.limiteMaximo.fonte)) + '). O simulador <b>não</b> presume que a alíquota será esse limite.';
  } else {
    h.innerHTML = 'Não há alíquota pré-definida para esta categoria nesta ferramenta.';
  }
}
function sincronizarIS(){
  $('isCampos').className = $('isSujeita').checked ? '' : 'hidden';
  var usar = $('isUsarCustom').checked;
  $('isAliquota').disabled = !usar;
  $('isStatusTag').className = 'st st-' + (usar ? 'USER_CUSTOM' : 'PENDING_LAW');
  $('isStatusTag').textContent = usar ? STATUS.USER_CUSTOM.rotulo : STATUS.PENDING_LAW.rotulo;
  $('isAliqHelp').innerHTML = usar
    ? 'Percentual hipotético válido <b>apenas para esta simulação</b>. Não corresponde a alíquota definida em norma.'
    : 'Enquanto a alíquota não estiver definida em norma, o Imposto Seletivo permanece em R$ 0,00. Marque a opção acima para testar um percentual hipotético.';
}

/* ---------------- modo de entrada de cada tributo atual ---------------- */
/* mapa tributo -> campos de alíquota da configuração central */
var RATE_INPUTS = {
  pis:    { input:'pisAliq',    tag:'tagPis' },
  cofins: { input:'cofinsAliq', tag:'tagCofins' },
  icms:   { input:'icmsAliq',   tag:'tagIcms' },
  iss:    { input:'issAliq',    tag:'tagIss' },
  ipi:    { input:'ipiAliq',    tag:'tagIpi' }
};
var TRIBUTOS_MODO = ['pisCofins','icms','iss','ipi'];

/** semeia os campos de alíquota a partir da configuração central.
    Se um dia houver premissa validada em FISCAL_RULES, ela aparece aqui sozinha. */
function semearAliquotasDaConfig(){
  Object.keys(RATE_INPUTS).forEach(function(k){
    var p = FISCAL_RULES_PADRAO.tributosAtuais.aliquotas[k];
    $(RATE_INPUTS[k].input).value = (p && p.valor != null) ? p.valor : '';
  });
  sincronizarAliquotasAtuais();
}

/** espelha as alíquotas digitadas na configuração central e atualiza as etiquetas */
function sincronizarAliquotasAtuais(){
  Object.keys(RATE_INPUTS).forEach(function(k){
    var el = $(RATE_INPUTS[k].input);
    var bruto = String(el.value).trim();
    var p = FISCAL_RULES.tributosAtuais.aliquotas[k];
    var padrao = FISCAL_RULES_PADRAO.tributosAtuais.aliquotas[k];
    if(bruto === ''){
      p.valor = padrao.valor;
      p.status = padrao.status;
    } else {
      p.valor = num(bruto);
      p.status = (padrao.valor != null && num(bruto) === num(padrao.valor)) ? padrao.status : 'USER_CUSTOM';
    }
    var tag = $(RATE_INPUTS[k].tag);
    tag.className = 'st st-' + p.status;
    tag.textContent = STATUS[p.status].rotulo;
    tag.title = STATUS[p.status].desc;
  });
}

/** mostra o resultado calculado de cada tributo em modo RATE */
function atualizarSaidasRate(){
  var norm = normalizeCurrentTaxes(coletarEntradasTributosAtuais());
  var d = norm.detalhe;
  if(modosTributo.pisCofins === 'RATE'){
    $('out_pisCofins').innerHTML =
      '<span>PIS estimado</span><span>' + money(d.pisCofins.pis.valor) + '</span>' +
      '<span style="flex:1 1 100%;height:0"></span>' +
      '<span>Cofins estimada</span><span>' + money(d.pisCofins.cofins.valor) + '</span>' +
      '<span style="flex:1 1 100%;height:0"></span>' +
      '<span>PIS + Cofins total</span><span>' + money(d.pisCofins.valor) + '</span>';
  }
  [['icms','out_icms'],['iss','out_iss'],['ipi','out_ipi']].forEach(function(par){
    if(modosTributo[par[0]] !== 'RATE') return;
    /* Tributo fora do segmento ativo entra na normalização como VALUE zerado e
       não tem base nem alíquota. O campo está oculto de qualquer modo: a prévia
       apenas informa por que não há cálculo, em vez de formatar um nulo. */
    var x = d[par[0]];
    if(!x || x.base == null){
      $(par[1]).innerHTML = '<span>Não considerado no segmento/modo atual</span><span>' + money(0) + '</span>';
      return;
    }
    $(par[1]).innerHTML = '<span>Resultado calculado</span><span>' + money(x.valor) + '</span>' +
      '<span class="sub">' + money(x.base) + ' × ' + pctFmt(x.aliquota) + '</span>';
  });
}

/** alterna VALUE <-> RATE preservando tudo o que já foi digitado */
function sincronizarModoTributo(trib){
  var modo = modosTributo[trib];
  $('v_' + trib).className = 'modo-value' + (modo === 'RATE' ? ' hidden' : '');
  $('r_' + trib).className = 'modo-rate'  + (modo === 'RATE' ? '' : ' hidden');
  var btn = $('modo_' + trib);
  btn.textContent = modo === 'RATE' ? 'Informar valor recolhido' : 'Usar alíquota';
  btn.setAttribute('aria-pressed', modo === 'RATE' ? 'true' : 'false');
  atualizarSaidasRate();
}
function sincronizarTodosOsModos(){ TRIBUTOS_MODO.forEach(sincronizarModoTributo); }

/* =====================================================================
   TRIBUTOS ATIVOS NO MODO SIMPLE
   ---------------------------------------------------------------------
   Campo escondido pelo segmento não podia continuar entrando na conta.
   Em homologação, uma empresa de Serviços recebeu ICMS de R$ 45.000 e IPI
   de R$ 8.000 que nunca foram digitados naquele contexto: os valores
   estavam no formulário, os campos estavam ocultos, e a coleta lia o DOM
   assim mesmo.

   Esta é a ÚNICA fonte da resposta "este tributo participa?". A mesma
   função responde pela visibilidade, pela coleta, pela memória e pelos
   relatórios — não há uma segunda regra espalhada pela aplicação.

   Não é regra fiscal nova: usa exatamente a lista de tributos por segmento
   que já existia em FISCAL_RULES.segmentos. Por isso vive na camada de
   interface, fora do motor.

   Vale só para o fluxo SIMPLE. No DETAILED cada operação declara os
   próprios tributos e o segmento é apenas organizacional (ver coletarDados).
   ===================================================================== */
function tributosAtivosNoSimple(segmento, forcarTodos){
  var cfg = null;
  FISCAL_RULES.segmentos.forEach(function(x){ if(x.id === segmento) cfg = x; });
  function ativo(id){ return !!forcarTodos || !!(cfg && cfg.tributos.indexOf(id) >= 0); }
  return {
    // PIS e Cofins são federais e valem para todo segmento
    pisCofins: true,
    icms: ativo('icms'),
    iss:  ativo('iss'),
    ipi:  ativo('ipi')
  };
}

/** o mesmo mapa, lido do estado atual da tela */
function tributosAtivosDaTela(){
  return tributosAtivosNoSimple($('segmento').value, $('forcarTodos').checked);
}

/* ---------------- visibilidade dos tributos por segmento ---------------- */
function sincronizarSegmento(){
  var ativos = tributosAtivosDaTela();
  [['pisCofins','f_pisCofins'],['icms','f_icms'],['iss','f_iss'],['ipi','f_ipi']].forEach(function(par){
    $(par[1]).className = 'field' + (ativos[par[0]] ? '' : ' hidden');
  });
}

/* ---------------- premissas avançadas ---------------- */
var CAMPOS_ANO = [
  { chave:'ibs',              rotulo:'IBS',                   sufixo:'%' },
  { chave:'cbs',              rotulo:'CBS',                   sufixo:'%' },
  { chave:'icmsRemanescente', rotulo:'ICMS remanescente',     sufixo:'%' },
  { chave:'issRemanescente',  rotulo:'ISS remanescente',      sufixo:'%' },
  { chave:'ipiPadrao',        rotulo:'IPI mantido',           sufixo:'%' }
];

function renderPremissas(){
  var anos = FISCAL_RULES.meta.anos;
  var h = '<thead><tr><th>Ano</th>';
  CAMPOS_ANO.forEach(function(c){ h += '<th>'+esc(c.rotulo)+'</th>'; });
  h += '<th>PIS/Cofins</th></tr></thead><tbody>';
  anos.forEach(function(ano){
    var r = FISCAL_RULES.anos[ano];
    h += '<tr><td class="yr">'+ano+'</td>';
    CAMPOS_ANO.forEach(function(c){
      var p = r[c.chave];
      h += '<td><input type="number" step="0.01" min="0" inputmode="decimal" id="prem_'+ano+'_'+c.chave+'" data-ano="'+ano+'" data-campo="'+c.chave+'" value="'+p.valor+'">'+
           '<div style="margin-top:5px">'+tagStatus(p.status)+'</div></td>';
    });
    h += '<td class="muted">Extinto</td></tr>';
  });
  h += '</tbody>';
  $('premTabela').innerHTML = h;

  Array.prototype.forEach.call($('premTabela').querySelectorAll('input'), function(inp){
    inp.addEventListener('input', function(){
      var ano = this.getAttribute('data-ano'), campo = this.getAttribute('data-campo');
      var p = FISCAL_RULES.anos[ano][campo];
      var padrao = FISCAL_RULES_PADRAO.anos[ano][campo];
      p.valor = num(this.value);
      p.status = (num(this.value) === num(padrao.valor)) ? padrao.status : 'USER_CUSTOM';
      p.dataBase = p.status === 'USER_CUSTOM' ? hojeISO() : padrao.dataBase;
      var cell = this.parentNode.querySelector('.st');
      if(cell){ cell.className = 'st st-'+p.status; cell.textContent = STATUS[p.status].rotulo; cell.title = STATUS[p.status].desc; }
      atualizarNotaAno();
    });
  });

  var lp = FISCAL_RULES.longoPrazo;
  $('premNota').innerHTML =
    'Referência de longo prazo: alíquota-padrão conjunta estimada de <b>'+pctFmt(lp.aliquotaPadraoConjunta.valor)+'</b> '+tagStatus(lp.aliquotaPadraoConjunta.status)+
    ', composta por IBS de <b>'+pctFmt(lp.ibsCheio.valor)+'</b> '+tagStatus(lp.ibsCheio.status)+
    ' e CBS de <b>'+pctFmt(lp.cbsCheia.valor)+'</b> '+tagStatus(lp.cbsCheia.status)+'. '+
    'Fonte registrada: '+esc(rotuloFonte('RES14'))+'. Estimativas e projeções <b>não</b> são alíquotas legalmente definitivas e podem ser editadas acima.';
}

function hojeISO(){
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

/* =====================================================================
   CBS DE 2027 E 2028 — POR QUE 9,11%
   ---------------------------------------------------------------------
   Pergunta recorrente em homologação: a referência da CBS no conjunto é
   9,21%, mas 2027 e 2028 aparecem com 9,11%. A diferença é a redução
   transitória de 0,10 ponto percentual prevista para esses dois anos.
   Nada aqui calcula nem altera alíquota: FISCAL_RULES continua sendo a
   única fonte dos números. Este bloco existe só para explicar o motivo
   onde o usuário lê o percentual.
   ===================================================================== */
var ANOS_CBS_REDUZIDA = ['2027','2028'];

/** o ano recebe a redução transitória de 0,10 p.p. na CBS? */
function anoTemCbsReduzida(ano){ return ANOS_CBS_REDUZIDA.indexOf(String(ano)) >= 0; }

/** diferença, em pontos percentuais, entre a CBS de referência e a do ano.
    Sai como número puro: 'ponto percentual' já vem escrito no texto, e
    'de 0,10% ponto percentual' seria redundante e errado. */
function reducaoCbsDoAno(ano){
  var cheia = FISCAL_RULES.longoPrazo.cbsCheia.valor;
  var doAno = FISCAL_RULES.anos[String(ano)].cbs.valor;
  return Math.round((cheia - doAno) * 100) / 100;
}
function ppFmt(v){ return Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }); }

/** explicação curta, para a nota do seletor de ano e para os relatórios.
    Devolve '' nos anos sem redução, para não repetir texto onde não cabe. */
function explicacaoCbs(ano){
  if(!anoTemCbsReduzida(ano)) return '';
  var cheia = FISCAL_RULES.longoPrazo.cbsCheia.valor;
  var doAno = FISCAL_RULES.anos[String(ano)].cbs.valor;
  return 'Como se chega à CBS de ' + pctFmt(doAno) + '? Usa-se a estimativa de referência de ' + pctFmt(cheia) +
         ' e desconta-se ' + ppFmt(reducaoCbsDoAno(ano)) + ' ponto percentual da redução transitória vigente em ' +
         '2027 e 2028. O percentual obtido (' + pctFmt(doAno) + ') é projeção de cenário, e não alíquota definitiva.';
}

/** mesma explicação no formato usado na coluna de observação das premissas */
function obsCbsDoAno(ano){
  var r = FISCAL_RULES.anos[String(ano)];
  if(!anoTemCbsReduzida(ano)) return r.cbs.descricao;
  var cheia = FISCAL_RULES.longoPrazo.cbsCheia.valor;
  return 'Estimativa de referência da CBS em ' + pctFmt(cheia) + ', menos a redução transitória de ' +
         ppFmt(reducaoCbsDoAno(ano)) + ' p.p. aplicável em 2027/2028, chegando a ' +
         pctFmt(r.cbs.valor) + '. Trata-se de projeção, não de valor definitivo.';
}

/** observação da premissa de referência da CBS cheia */
function obsCbsReferencia(){
  var lp = FISCAL_RULES.longoPrazo;
  return lp.cbsCheia.descricao + ' Base estimada do cenário. Nos anos 2027 e 2028 aplica-se ' +
         'a redução transitória de ' + ppFmt(reducaoCbsDoAno('2027')) + ' p.p., o que leva a ' +
         pctFmt(FISCAL_RULES.anos['2027'].cbs.valor) + '.';
}

/* Seletores customizados: highlight no verde da página (--lr).
   O <select> nativo no Chrome/Edge Windows não permite trocar o azul do SO. */
var _cSelDocBound = false;

function wrapDoSeletor(sel){
  return sel && sel.closest ? sel.closest('.c-sel') : null;
}

function sincronizarSeletorCustom(sel){
  if(!sel) return;
  var wrap = wrapDoSeletor(sel);
  if(!wrap) return;
  var btn = wrap.querySelector('.c-sel-btn');
  var list = wrap.querySelector('.c-sel-list');
  var opt = sel.options[sel.selectedIndex];
  if(btn) btn.textContent = opt ? opt.text : sel.value;
  if(list){
    Array.prototype.forEach.call(list.children, function(li){
      var ativo = li.getAttribute('data-value') === sel.value;
      li.classList.toggle('is-active', ativo);
      if(ativo) li.setAttribute('aria-selected', 'true');
      else li.removeAttribute('aria-selected');
    });
  }
}

function sincronizarSeletorAno(){ sincronizarSeletorCustom($('ano')); }

function fecharSeletorCustom(wrap){
  if(!wrap) return;
  var list = wrap.querySelector('.c-sel-list');
  var btn = wrap.querySelector('.c-sel-btn');
  if(list) list.hidden = true;
  if(btn) btn.setAttribute('aria-expanded', 'false');
}

function fecharTodosSeletoresCustom(exceto){
  Array.prototype.forEach.call(document.querySelectorAll('.c-sel'), function(wrap){
    if(exceto && wrap === exceto) return;
    fecharSeletorCustom(wrap);
  });
}

function reconstruirOpcoesSeletor(sel){
  var wrap = wrapDoSeletor(sel);
  if(!wrap) return;
  var list = wrap.querySelector('.c-sel-list');
  if(!list) return;
  list.innerHTML = '';
  Array.prototype.forEach.call(sel.options, function(opt){
    var li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('data-value', opt.value);
    li.textContent = opt.text;
    li.addEventListener('click', function(){
      if(sel.value !== opt.value){
        sel.value = opt.value;
        var ev;
        try{ ev = new Event('change', { bubbles:true }); }
        catch(e){ ev = document.createEvent('Event'); ev.initEvent('change', true, false); }
        sel.dispatchEvent(ev);
      } else {
        sincronizarSeletorCustom(sel);
      }
      fecharSeletorCustom(wrap);
    });
    list.appendChild(li);
  });
  sincronizarSeletorCustom(sel);
}

function montarSeletorCustom(sel){
  if(!sel || sel.getAttribute('data-enhanced') === '1') return;
  sel.setAttribute('data-enhanced', '1');

  var wrap = document.createElement('div');
  var isYear = sel.id === 'ano';
  var isCompact = sel.id === 'anoResultado';
  wrap.className = 'c-sel' + (isYear ? ' c-sel-year' : ' c-sel-field');
  if(!isYear && !isCompact) wrap.classList.add('c-sel-full');
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add('c-sel-native');
  sel.setAttribute('tabindex', '-1');
  sel.setAttribute('aria-hidden', 'true');

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'c-sel-btn' + (isYear ? ' c-sel-btn-year' : '');
  if(sel.id) btn.id = sel.id + 'Btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  wrap.insertBefore(btn, sel);

  if(sel.id){
    var lab = document.querySelector('label[for="'+sel.id+'"]');
    if(lab && btn.id) lab.htmlFor = btn.id;
  }

  var list = document.createElement('ul');
  list.className = 'c-sel-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(list);
  reconstruirOpcoesSeletor(sel);

  function abrir(){
    fecharTodosSeletoresCustom(wrap);
    sincronizarSeletorCustom(sel);
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
  function fechar(){ fecharSeletorCustom(wrap); }

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    if(list.hidden) abrir(); else fechar();
  });
  btn.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ fechar(); return; }
    if(e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      if(list.hidden) abrir();
    }
  });

  if(!_cSelDocBound){
    _cSelDocBound = true;
    document.addEventListener('click', function(e){
      var t = e.target;
      if(t && t.closest && t.closest('.c-sel')) return;
      fecharTodosSeletoresCustom(null);
    });
    document.addEventListener('change', function(e){
      if(e.target && e.target.tagName === 'SELECT') sincronizarSeletorCustom(e.target);
    }, true);
  }
}

function montarSeletorAno(){ montarSeletorCustom($('ano')); }

function montarSeletoresNa(raiz){
  var escopo = raiz || document;
  Array.prototype.forEach.call(escopo.querySelectorAll('select'), montarSeletorCustom);
}

function atualizarNotaAno(){
  var ano = $('ano').value, r = FISCAL_RULES.anos[ano];
  // a explicação da CBS fica VISÍVEL no próprio card, não em tooltip
  var explica = explicacaoCbs(ano);
  $('yearNote').innerHTML =
    'Cenário de '+ano+': IBS a <b>'+pctFmt(r.ibs.valor)+'</b> ('+STATUS[r.ibs.status].rotulo+'); '+
    'CBS a <b>'+pctFmt(r.cbs.valor)+'</b> ('+STATUS[r.cbs.status].rotulo+'); '+
    'ICMS e ISS permanecem em <b>'+pctFmt(r.icmsRemanescente.valor,0)+'</b> e <b>'+pctFmt(r.issRemanescente.valor,0)+'</b>; '+
    'no cenário da Reforma, PIS/Cofins <b>deixam de existir</b>.' +
    (explica ? '<span class="year-cbs">'+esc(explica)+'</span>' : '');
}

/* customizações do usuário, para salvar junto com o cliente */
function coletarCustomizacoes(){
  var out = [];
  FISCAL_RULES.meta.anos.forEach(function(ano){
    CAMPOS_ANO.forEach(function(c){
      var p = FISCAL_RULES.anos[ano][c.chave], d = FISCAL_RULES_PADRAO.anos[ano][c.chave];
      if(num(p.valor) !== num(d.valor)) out.push({ ano:ano, campo:c.chave, valor:num(p.valor) });
    });
  });
  return out;
}
function aplicarCustomizacoes(lista){
  FISCAL_RULES = clonar(FISCAL_RULES_PADRAO);
  (lista||[]).forEach(function(it){
    var p = FISCAL_RULES.anos[it.ano] && FISCAL_RULES.anos[it.ano][it.campo];
    if(!p) return;
    p.valor = num(it.valor);
    p.status = 'USER_CUSTOM';
  });
  renderPremissas();
  // as alíquotas de tributo atual vivem na mesma configuração: re-espelha a tela
  sincronizarAliquotasAtuais();
  atualizarNotaAno();
}

/* =====================================================================
   RENDERIZAÇÃO DOS RESULTADOS
   ===================================================================== */

function linha(l, v, cls){
  return '<div class="line'+(cls?' '+cls:'')+'"><span class="l">'+l+'</span><span class="v">'+v+'</span></div>';
}

/** descreve a origem de um tributo atual (modo VALUE ou RATE) */
function textoOrigem(det){
  if(!det) return 'Média histórica informada';
  // tributo fora do segmento ativo: zerado de propósito, não é falta de dado
  if(det.inativoNoSegmento) return 'Não considerado no segmento/modo atual.';
  if(det.modo === 'DETAILED') return det.origem || 'Somado do detalhamento por operação';
  if(det.modo !== 'RATE') return 'Média histórica informada';
  if(det.pis && det.cofins){
    return 'Calculado pelo usuário por alíquota · PIS: ' + money(det.pis.base) + ' × ' + pctFmt(det.pis.aliquota) +
           ' · Cofins: ' + money(det.cofins.base) + ' × ' + pctFmt(det.cofins.aliquota);
  }
  return 'Calculado pelo usuário por alíquota · Base: ' + money(det.base) + ' · Alíquota: ' + pctFmt(det.aliquota);
}
function linhaComOrigem(rot, valor, det){
  return '<div class="line"><span class="l">' + rot +
    '<span class="origem-tag">' + esc(textoOrigem(det)) + '</span></span>' +
    '<span class="v">' + money(valor) + '</span></div>';
}

/** tabela de débitos e créditos, com bruto, estorno e utilizável separados.
    Usada na tela e no relatório — nenhum componente é escondido. */
function tabelaCreditos(R){
  var e = R.estorno;
  var h = '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Item</th><th>IBS</th><th>CBS</th><th>Total</th></tr></thead><tbody>';
  h += '<tr><td>Débito sobre a receita</td><td>'+money(R.debito.ibs)+'</td><td>'+money(R.debito.cbs)+'</td><td>'+money(R.debito.total)+'</td></tr>';
  h += '<tr><td>Crédito potencial bruto</td><td>'+money(R.creditoBruto.ibs)+'</td><td>'+money(R.creditoBruto.cbs)+'</td><td>'+money(R.creditoBruto.total)+'</td></tr>';
  h += '<tr><td>Estorno estimado por isenção/imunidade'+
       (e.aplicavel ? ' ('+pctFmt(e.percentualEstorno)+')' : '')+
       '</td><td>'+money(e.estorno.ibs)+'</td><td>'+money(e.estorno.cbs)+'</td><td>'+money(e.estorno.total)+'</td></tr>';
  h += '<tr><td>Crédito utilizável estimado</td><td>'+money(R.credito.ibs)+'</td><td>'+money(R.credito.cbs)+'</td><td>'+money(R.credito.total)+'</td></tr>';
  h += '<tr><td>Saldo a recolher</td><td>'+money(R.liquido.ibs)+'</td><td>'+money(R.liquido.cbs)+'</td><td>'+money(R.liquido.total)+'</td></tr>';
  h += '<tr><td>Saldo credor estimado</td><td>'+money(R.liquido.saldoCredorIbs)+'</td><td>'+money(R.liquido.saldoCredorCbs)+'</td><td>'+money(R.liquido.saldoCredorTotal)+'</td></tr>';
  return h + '</tbody></table></div>';
}

/** memória de cálculo do IBS/CBS: mostra como se chegou ao débito e ao crédito,
    linha a linha, do mesmo modo que o regime atual mostra base × alíquota.
    Usa apenas valores já calculados — nenhuma conta nova. */
/** tabela das operações que formam a situação atual no modo detalhado.
    O total tem de reconciliar exatamente com R.atual.total. */
function tabelaSituacaoAtualDetalhada(P){
  if(!P || P.currentRevenueMode !== 'DETAILED' || !P.atualDetalhado) return '';
  var d = P.atualDetalhado;
  var uni = d.origem === 'DETAILED_UNIFIED';
  // só abre PIS e Cofins quando TODAS as linhas já têm os dois separados
  var sep = uni && !d.linhasCombinadoLegado;
  var h = '<div class="memo"><div class="memo-h">' +
          (uni ? 'Formada pelo detalhamento unificado de ' : 'Situação atual formada pelo detalhamento de ') +
          d.linhas.length + (d.linhas.length === 1 ? ' operação' : ' operações') + '</div>';
  h += '<div class="table-hint">Deslize a tabela para o lado para ver todas as colunas.</div>';
  h += '<div class="table-scroll"><table class="rp-tab tab-densa"><thead><tr>' +
       '<th>Descrição</th><th>Natureza</th><th>Faturamento</th>' +
       (sep ? '<th>PIS</th><th>Cofins</th>' : '<th>PIS e Cofins</th>') +
       '<th>ICMS</th><th>ISS</th><th>IPI</th><th>Tributos</th><th>Carga efetiva</th>' +
       (uni ? '<th>Tratamento na Reforma</th>' : '') + '</tr></thead><tbody>';
  d.linhas.forEach(function(l){
    h += '<tr><td>' + esc(l.descricao) + '</td>' +
         '<td style="text-align:left">' + esc(l.naturezaRotulo) + '</td>' +
         '<td>' + money(l.faturamento) + '</td>' +
         (sep ? '<td>' + money(l.pis) + '</td><td>' + money(l.cofins) + '</td>'
              : '<td>' + money(l.pisCofins) + '</td>') +
         '<td>' + money(l.icms) + '</td>' +
         '<td>' + money(l.iss) + '</td>' +
         '<td>' + money(l.ipi) + '</td>' +
         '<td>' + money(l.tributos) + '</td>' +
         '<td>' + (l.cargaEfetiva == null ? '—' : pctFmt(l.cargaEfetiva)) + '</td>' +
         (uni ? '<td style="text-align:left">' + esc(l.tratamentoRotulo) +
                (l.pctCustom != null ? ' (' + pctFmt(l.pctCustom,0) + ')' : '') + '</td>' : '') + '</tr>';
  });
  if(!d.linhas.length){
    h += '<tr><td colspan="' + ((uni ? 10 : 9) + (sep ? 1 : 0)) + '" style="text-align:left;color:var(--muted)">Nenhuma operação informada.</td></tr>';
  }
  h += '</tbody><tfoot><tr><td>Totais</td><td></td><td>' + money(d.faturamentoDetalhado) + '</td>' +
       (sep ? '<td>' + money(d.pis) + '</td><td>' + money(d.cofins) + '</td>'
            : '<td>' + money(d.pisCofins) + '</td>') +
       '<td>' + money(d.icms) + '</td><td>' + money(d.iss) + '</td>' +
       '<td>' + money(d.ipi) + '</td><td>' + money(d.totalTributos) + '</td><td></td>' +
       (uni ? '<td></td>' : '') + '</tr></tfoot></table></div>';
  h += '<div class="memo-n">A coluna <b>Carga efetiva</b> é a relação matemática entre os tributos informados e a ' +
       'receita da própria linha — não é alíquota fiscal. No modo detalhado, estes totais substituem integralmente ' +
       'os valores gerais da situação atual.' +
       (uni ? ' A última coluna mostra o tratamento de IBS/CBS escolhido por você para a mesma operação, permitindo ' +
              'relacionar cada receita de hoje com o cenário Reforma pela descrição.' : '') +
       '</div></div>';
  return h;
}

/** memória da carga tributária: mostra como os totais foram formados,
    usando exclusivamente os números já produzidos por calculateTaxBurdenBreakdown. */
function memoriaCarga(C){
  function conta(b){ return b.pct == null ? 'não aplicável' : pctFmt(b.pct); }
  function bloco(titulo, g){
    var h = '<div class="vc-bloco"><div class="vc-t">' + titulo + '</div>';
    h += '<div class="vc-l"><span>Federais</span><b>' + money(g.federais.valor) + '</b></div>';
    h += '<div class="vc-op">+</div>';
    h += '<div class="vc-l"><span>Estaduais e municipais</span><b>' + money(g.estaduaisMunicipais.valor) + '</b></div>';
    h += '<div class="vc-l vc-eq"><span>Carga tributária</span><b>' + money(g.tributaria.valor) + ' por mês</b></div>';
    h += '<div class="vc-c">' + money(g.tributaria.valor) + ' ÷ ' + money(C.faturamento) + ' de faturamento = <b>' + conta(g.tributaria) + '</b></div>';
    h += '<div class="vc-c">Anualização: ' + money(g.tributaria.valor) + ' × 12 = <b>' + money(g.tributaria.valor * 12) + ' por ano</b></div>';
    h += '<div class="vc-l" style="margin-top:10px"><span>Carga tributária</span><b>' + money(g.tributaria.valor) + '</b></div>';
    h += '<div class="vc-op">+</div>';
    h += '<div class="vc-l"><span>Encargos trabalhistas/previdenciários</span><b>' + money(g.encargos.valor) + '</b></div>';
    h += '<div class="vc-l vc-eq"><span>Carga completa considerada</span><b>' + money(g.completa.valor) + ' por mês</b></div>';
    h += '<div class="vc-c">' + money(g.completa.valor) + ' × 12 = <b>' + money(g.completa.valor * 12) + ' por ano</b></div>';
    return h + '</div>';
  }
  return '<div class="vc-cols">' + bloco('Situação atual', C.atual) +
         bloco('Cenário Reforma ' + C.ano, C.reforma) + '</div>' +
         '<div class="memo-n">Os encargos trabalhistas/previdenciários entram apenas na carga completa e permanecem ' +
         'iguais nos dois cenários, por serem médias históricas informadas.</div>';
}

/** memória da situação atual e do cenário Reforma, reaproveitando as memórias já existentes */
function memoriaSituacaoEReforma(R, P){
  var det = (P && P.atualDetalhe) || {};
  var h = '<div class="vc-bloco"><div class="vc-t">Situação atual — como cada tributo foi informado</div>';
  if(P && P.currentRevenueMode === 'DETAILED' && P.atualDetalhado){
    var n = P.atualDetalhado.linhas.length;
    h += '<div class="vc-c">Total formado pela soma de <b>' + n + (n === 1 ? ' operação' : ' operações') +
         '</b> detalhadas. O detalhamento completo está na tabela logo abaixo deste bloco.</div>';
    if(P.revenueModelUnified){
      h += '<div class="vc-c">Cada operação abaixo aparece com a mesma descrição na memória do débito de IBS/CBS, ' +
           'permitindo comparar a mesma receita nos dois cenários.</div>';
      P.atualDetalhado.linhas.forEach(function(l){
        h += '<div class="vc-l"><span>' + esc(l.descricao) + '</span><b>' + money(l.tributos) + '</b></div>';
        h += '<div class="vc-c">Receita ' + money(l.faturamento) + ' · ' + textoPisCofinsDaOperacao(l) +
             ' · ICMS ' + money(l.icms) + ' · ISS ' + money(l.iss) + ' · IPI ' + money(l.ipi) +
             ' · tratamento na Reforma: <b>' + esc(l.tratamentoRotulo) + '</b></div>';
      });
      h += '<div class="vc-c" style="margin-top:8px">Somatório por tributo:</div>';
    }
    componentesPisCofins(R, P).forEach(function(c){
      h += '<div class="vc-l"><span>' + esc(c.rotulo) + '</span><b>' + money(c.valor) + '</b></div>';
    });
    [['ICMS','icms'],['ISS','iss'],['IPI','ipi']].forEach(function(par){
      h += '<div class="vc-l"><span>' + par[0] + '</span><b>' + money(R.atual[par[1]]) + '</b></div>';
    });
  } else {
    componentesPisCofins(R, P).forEach(function(c){
      h += '<div class="vc-l"><span>' + esc(c.rotulo) + '</span><b>' + money(c.valor) + '</b></div>';
      if(c.det && c.det.modo !== 'RATE'){
        h += '<div class="vc-c">Valor mensal informado' + (c.combinado ? ' em valor combinado' : '') + '</div>';
      }
    });
    [['ICMS','icms'],['ISS','iss'],['IPI','ipi']].forEach(function(par){
      var d = det[par[1]] || {};
      h += '<div class="vc-l"><span>' + par[0] + '</span><b>' + money(R.atual[par[1]]) + '</b></div>';
      if(d.modo === 'RATE'){
        if(d.pis && d.cofins){
          h += '<div class="vc-c">PIS: ' + money(d.pis.base) + ' × ' + pctAliq(d.pis.aliquota) + ' = <b>' + money(d.pis.valor) + '</b></div>';
          h += '<div class="vc-c">Cofins: ' + money(d.cofins.base) + ' × ' + pctAliq(d.cofins.aliquota) + ' = <b>' + money(d.cofins.valor) + '</b></div>';
          h += '<div class="vc-c">Total: <b>' + money(d.valor) + '</b></div>';
        } else {
          h += '<div class="vc-c">' + money(d.base) + ' × ' + pctAliq(d.aliquota) + ' = <b>' + money(d.valor) + '</b></div>';
        }
      } else {
        h += '<div class="vc-c">Valor mensal informado · ' + esc(textoOrigem(d)) + '</div>';
      }
    });
  }
  h += '<div class="vc-l vc-eq"><span>Total atual</span><b>' + money(R.atual.total) + '</b></div></div>';

  // cenário Reforma: reaproveita as memórias já validadas
  h += '<div class="vc-bloco"><div class="vc-t">Cenário Reforma ' + R.ano + '</div>';
  h += memoriaIbsCbs(R);
  h += tabelaCreditos(R);
  h += explicacaoEstorno(R, false);
  h += '<div class="vc-t" style="margin-top:14px">Tributos remanescentes no cenário</div>';
  h += '<div class="vc-l"><span>ICMS remanescente (' + pctFmt(R.legado.fatorIcms, 0) + ')</span><b>' + money(R.legado.icms) + '</b></div>';
  h += '<div class="vc-l"><span>ISS remanescente (' + pctFmt(R.legado.fatorIss, 0) + ')</span><b>' + money(R.legado.iss) + '</b></div>';
  h += '<div class="vc-l"><span>IPI residual / ZFM</span><b>' + money(R.legado.ipi) + '</b></div>';
  h += '<div class="vc-l"><span>Imposto Seletivo</span><b>' + money(R.seletivo.valor) + '</b></div>';
  h += '<div class="vc-l vc-eq"><span>Total projetado</span><b>' + money(R.consumoReforma) + '</b></div>';
  return h + '</div>';
}

/* =====================================================================
   COMPONENTES DE PIS/COFINS E IRPJ/CSLL — APRESENTAÇÃO
   ---------------------------------------------------------------------
   Devolvem os componentes separados quando eles existem, e a linha combinada
   quando o registro ainda é do modelo antigo. Nunca repartem um agregado.
   ===================================================================== */

/** ICMS, ISS e IPI que devem aparecer na apresentação.
    omitirInativos = relatório executivo, onde a linha zerada só atrapalha. */
function componentesLegados(R, P, omitirInativos){
  var ativos = (P && P.tributosAtivos) || { icms:true, iss:true, ipi:true };
  var dt = (P && P.atualDetalhe) || {};
  return [['ICMS','icms'],['ISS','iss'],['IPI','ipi']].filter(function(par){
    return ativos[par[1]] || !omitirInativos;
  }).map(function(par){
    return { rotulo:par[0], chave:par[1], valor:R.atual[par[1]],
             det:dt[par[1]], campoId:'atual'+par[0].charAt(0)+par[0].slice(1).toLowerCase(),
             ativo: !!ativos[par[1]] };
  });
}

/** [{rotulo, valor, det, campoId}] de PIS e Cofins */
function componentesPisCofins(R, P){
  var d = (P && P.atualDetalhe && P.atualDetalhe.pisCofins) || {};
  if(d.pis && d.cofins && d.pis.valor != null && d.cofins.valor != null){
    var rate = (d.modo === 'RATE');
    return [
      { rotulo:'PIS',    valor:d.pis.valor,    det:d.pis,    campoId: rate ? 'pisBase' : 'atualPis' },
      { rotulo:'Cofins', valor:d.cofins.valor, det:d.cofins, campoId: rate ? 'cofinsBase' : 'atualCofins' }
    ];
  }
  return [{ rotulo:'PIS e Cofins (valor combinado)', valor:R.atual.pisCofins, det:d,
            campoId:'atualPisCofins', combinado:true }];
}

/** [{rotulo, mensal, informado, periodicidade, campoId}] de IRPJ e CSLL */
function componentesIrpjCsll(P, R){
  var e = (P && P.irpjEntrada) || {};
  var per = e.periodicidade || 'MENSAL';
  if(e.combinadoLegado || !e.irpj || e.irpj.mensal == null){
    return [{ rotulo:'IRPJ e CSLL (valor combinado)', mensal:R.complementar.irpjCsll,
              informado: e.combinado ? e.combinado.informado : R.complementar.irpjCsll,
              periodicidade: per, campoId:'irpjCsll', combinado:true }];
  }
  return [
    { rotulo:'IRPJ', mensal:e.irpj.mensal, informado:e.irpj.informado, periodicidade:per, campoId:'irpj' },
    { rotulo:'CSLL', mensal:e.csll.mensal, informado:e.csll.informado, periodicidade:per, campoId:'csll' }
  ];
}

/** texto de origem de um componente de IRPJ/CSLL */
function origemIrpjCsll(c){
  if(c.periodicidade === 'TRIMESTRAL'){
    return 'Informado como média trimestral de ' + money(c.informado) + ', convertido para ' +
           money(c.mensal) + ' por mês (÷ 3). Não recalculado pela ferramenta.';
  }
  return 'Média mensal informada. Não recalculada pela ferramenta.';
}

/** valor + percentual sobre o faturamento numa mesma célula */
function celulaCarga(b){
  return money(b.valor) + '<div style="font-weight:600;color:#7f8083;font-size:.79rem;margin-top:2px">' +
    (b.pct == null ? 'não aplicável' : pctFmt(b.pct)) + '</div>';
}

/** painel comparativo da carga sobre o faturamento */
function tabelaCarga(C){
  var h = '<div class="table-scroll"><table class="rp-tab"><thead><tr>' +
    '<th>Componente</th><th>Situação atual</th><th>Reforma ' + C.ano + '</th></tr></thead><tbody>';
  h += '<tr><td>Federais</td><td>' + celulaCarga(C.atual.federais) + '</td><td>' + celulaCarga(C.reforma.federais) + '</td></tr>';
  h += '<tr><td>Estaduais e municipais</td><td>' + celulaCarga(C.atual.estaduaisMunicipais) + '</td><td>' + celulaCarga(C.reforma.estaduaisMunicipais) + '</td></tr>';
  h += '</tbody><tfoot>';
  h += '<tr><td>Carga tributária</td><td>' + celulaCarga(C.atual.tributaria) + '</td><td>' + celulaCarga(C.reforma.tributaria) + '</td></tr>';
  h += '<tr><td>Encargos trabalhistas/previdenciários</td><td>' + celulaCarga(C.atual.encargos) + '</td><td>' + celulaCarga(C.reforma.encargos) + '</td></tr>';
  h += '<tr><td>Carga completa considerada</td><td>' + celulaCarga(C.atual.completa) + '</td><td>' + celulaCarga(C.reforma.completa) + '</td></tr>';
  h += '</tfoot></table></div>';
  return h;
}
function notaCarga(C){
  var n = 'Percentuais calculados sobre o faturamento de <b>' + money(C.faturamento) + '</b> por mês. ' +
    'Neste comparativo, o IBS é apresentado no grupo <b>“Estaduais e municipais”</b> por possuir competência ' +
    'compartilhada entre Estados, Distrito Federal e Municípios. O simulador não realiza rateio interno do IBS entre essas esferas. ' +
    'Os <b>encargos trabalhistas/previdenciários</b> aparecem separados da carga tributária e permanecem iguais nos dois cenários, ' +
    'por serem médias históricas informadas.';
  if(!C.reconciliaAtual || !C.reconciliaReforma){
    n += ' <b>Atenção:</b> a soma por esfera não fechou com o total do cenário — ' +
      (C.reconciliaAtual ? '' : 'divergência na situação atual. ') +
      (C.reconciliaReforma ? '' : 'divergência no cenário Reforma. ') +
      'O valor exibido não foi ajustado para esconder a diferença.';
  }
  return n;
}

/** alíquota com até 4 casas: a efetiva de uma linha reduzida pode ter 3 (ex.: 3,684%) */
function pctAliq(n){
  return (isFinite(n)?n:0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4}) + '%';
}

/** memória de cálculo do IBS/CBS.
    A redução incide sobre a ALÍQUOTA, nunca sobre o valor da operação. Por isso
    a tabela mostra a alíquota efetiva de cada linha e aplica-a sobre a receita
    cheia — nada aqui é apresentado como "base de cálculo reduzida".
        aliquotaEfetiva = alíquota do ano × fator do tratamento
        débito         = valor da receita × aliquotaEfetiva / 100
    É a mesma matemática já validada no motor, apresentada de outra forma. */
function memoriaIbsCbs(R){
  var ai = R.aliquotas.ibs, ac = R.aliquotas.cbs;
  var h = '<div class="memo"><div class="memo-h">Memória de cálculo do débito — IBS e CBS em ' + R.ano + '</div>';
  h += '<div class="table-hint">Deslize a tabela para o lado para ver todas as colunas.</div>';
  h += '<div class="table-scroll"><table class="rp-tab tab-densa"><thead><tr>' +
       '<th>Receita</th><th>Valor</th><th>Tratamento</th><th>Fator</th>' +
       '<th>IBS efetivo</th><th>Débito IBS</th><th>CBS efetiva</th><th>Débito CBS</th></tr></thead><tbody>';
  (R.tratamento.linhas || []).forEach(function(l){
    var t = null;
    FISCAL_RULES.tratamentosReceita.forEach(function(x){ if(x.id === l.tratamento) t = x; });
    var efIbs = ai * l.fatorAliquota, efCbs = ac * l.fatorAliquota;
    h += '<tr><td>' + esc(l.descricao) + '</td>' +
         '<td>' + money(l.valor) + '</td>' +
         '<td style="text-align:left">' + esc(t ? t.rotulo : l.tratamento) + '</td>' +
         '<td>' + pctFmt(l.fatorAliquota * 100, 0) + '</td>' +
         '<td>' + pctAliq(efIbs) + '</td>' +
         '<td>' + money(l.valor * efIbs / 100) + '</td>' +
         '<td>' + pctAliq(efCbs) + '</td>' +
         '<td>' + money(l.valor * efCbs / 100) + '</td></tr>';
  });
  h += '</tbody><tfoot>' +
       '<tr><td>Débito total</td><td colspan="4"></td><td>' + money(R.debito.ibs) + '</td>' +
       '<td></td><td>' + money(R.debito.cbs) + '</td></tr>' +
       '</tfoot></table></div>';
  h += '<div class="memo-n">Cada linha entra pelo <b>valor cheio da receita</b>. O que a redução altera é a ' +
       '<b>alíquota</b>, não o valor da operação: a alíquota efetiva da linha é <b>alíquota do ano × fator do tratamento</b>, ' +
       'e o débito é <b>receita × alíquota efetiva</b>. Alíquota zero, isenção, exportação e imunidade resultam em alíquota efetiva de 0%.</div>';

  // como se chegou ao crédito bruto
  h += '<div class="memo-n">';
  if(R.modoCompras === 'DETAILED'){
    h += '<b>Crédito bruto:</b> calculado grupo a grupo no detalhamento de compras abaixo, somando ' +
         money(R.creditoBruto.ibs) + ' de IBS e ' + money(R.creditoBruto.cbs) + ' de CBS.';
  } else {
    h += '<b>Crédito bruto:</b> ' + money(R.creditoBruto.compras) + ' de compras × ' + pctFmt(R.creditoBruto.pct, 0) +
         ' creditáveis = ' + money(R.creditoBruto.base) + ' de base, que × ' + pctAliq(ai) + ' = <b>' + money(R.creditoBruto.ibs) +
         '</b> de IBS e × ' + pctAliq(ac) + ' = <b>' + money(R.creditoBruto.cbs) + '</b> de CBS.';
  }
  h += '</div></div>';
  return h;
}

/** origem do crédito bruto: estimativa simplificada ou detalhamento por grupo */
function blocoOrigemCreditos(R){
  if(R.modoCompras !== 'DETAILED'){
    return '<div class="estorno-box neutro" style="background:#f4f6fa;border-color:var(--line)">'+
      '<b>Modo de créditos das compras: estimativa simplificada.</b><br>'+
      'Compras: '+money(R.creditoBruto.compras)+' · Percentual creditável: '+pctFmt(R.creditoBruto.pct,0)+
      ' · Base estimada: '+money(R.creditoBruto.base)+' · Crédito bruto: '+money(R.creditoBruto.total)+'.</div>';
  }
  var d = R.comprasDetalhe;
  var h = '<div class="panel-h" style="margin-top:18px">Modo de créditos das compras: detalhado</div>';
  h += '<div class="table-hint">Deslize a tabela para o lado para ver todas as colunas.</div>';
  h += '<div class="table-scroll"><table class="rp-tab tab-densa"><thead><tr><th>Descrição</th><th>Valor/base</th><th>Tipo</th>'+
       '<th>Fator/redução</th><th>Crédito IBS</th><th>Crédito CBS</th><th>Total</th></tr></thead><tbody>';
  d.linhas.forEach(function(l){
    // classificação (sempre do usuário) e regra de cálculo aparecem separadas
    var origem = '<div style="margin-top:3px;font-weight:400;color:#7f8083;font-size:.75rem;line-height:1.4">'+
                 'Classificação: informada pelo usuário<br>'+esc(l.ruleRotulo || '')+'</div>';
    var alerta = l.legacySimpleCreditNeedsReview
      ? '<div style="margin-top:4px;font-size:.75rem;color:#8a6100;font-weight:600">Pendente de revisão: salvo no modelo anterior de fatores.</div>'
      : '';
    h += '<tr><td>'+esc(l.descricao)+alerta+'</td><td>'+money(l.valor)+'</td>'+
         '<td style="text-align:left">'+esc(l.tipoRotulo)+origem+'</td>'+
         '<td style="text-align:left">'+esc(l.detalheFator)+'</td>'+
         '<td>'+money(l.creditoIbs)+'</td><td>'+money(l.creditoCbs)+'</td><td>'+money(l.creditoTotal)+'</td></tr>';
  });
  if(!d.linhas.length){
    h += '<tr><td colspan="7" style="text-align:left;color:var(--muted)">Nenhum grupo de compras informado. No modo detalhado, sem grupos não há crédito.</td></tr>';
  }
  h += '</tbody><tfoot>'+
       '<tr><td>Compras totais</td><td>'+money(d.totalCompras)+'</td><td colspan="5"></td></tr>'+
       '<tr><td>Compras classificadas</td><td>'+money(d.comprasClassificadas)+'</td><td colspan="5"></td></tr>'+
       '<tr><td>Compras não classificadas</td><td>'+money(d.comprasNaoClassificadas)+'</td>'+
       '<td colspan="5" style="text-align:left;font-weight:600">sem crédito no modo detalhado</td></tr>'+
       '<tr><td>Crédito bruto</td><td colspan="3"></td><td>'+money(d.creditoBrutoIBS)+'</td><td>'+money(d.creditoBrutoCBS)+'</td><td>'+money(d.creditoBrutoTotal)+'</td></tr>'+
       '</tfoot></table></div>';
  if(d.comprasNaoClassificadas > 0.005){
    h += '<div class="estorno-box"><div class="estorno-n" style="margin-top:0">Existem compras ainda não classificadas ('+
         money(d.comprasNaoClassificadas)+'). No modo detalhado, apenas os grupos informados geram crédito.</div></div>';
  }
  return h;
}

/** explicação objetiva do estorno proporcional (tela e relatório) */
function explicacaoEstorno(R, paraRelatorio){
  var e = R.estorno;
  if(!e.aplicavel){
    return '<div class="estorno-box neutro">Nenhuma receita do período exige anulação proporcional de créditos. '+
      'Reduções de alíquota, alíquota zero e exportações <b>mantêm</b> os créditos das aquisições.</div>';
  }
  var lista = e.linhasEstorno.map(function(l){
    var t = null;
    FISCAL_RULES.tratamentosReceita.forEach(function(x){ if(x.id===l.tratamento) t = x; });
    return '<li>'+esc(l.descricao)+' — '+esc(t?t.rotulo:l.tratamento)+': <b>'+money(l.valor)+'</b></li>';
  }).join('');
  return '<div class="estorno-box">'+
    '<div class="estorno-h">Anulação proporcional de créditos</div>'+
    '<div class="estorno-l"><span>Receitas sujeitas à anulação proporcional de créditos</span><b>'+money(e.receitaEstorno)+'</b></div>'+
    '<div class="estorno-l"><span>Receita total</span><b>'+money(e.receitaTotal)+'</b></div>'+
    '<div class="estorno-l"><span>Percentual estimado de estorno</span><b>'+pctFmt(e.percentualEstorno)+'</b></div>'+
    '<ul class="estorno-ul">'+lista+'</ul>'+
    '<div class="estorno-n">Imunidade — regra geral de estorno proporcional. Exportações são tratadas separadamente e mantêm os créditos. '+
    'O estorno é aplicado separadamente ao IBS e à CBS, sem compensação entre eles.</div>'+
    '</div>';
}

/** frase executiva construída SOMENTE com valores já calculados.
    É diagnóstico, não recomendação: nada de "vale a pena" ou "melhor regime". */
function fraseExecutiva(R){
  var d = R.diferencaMes;
  var pct = R.diferencaPct;
  var sufixo = (pct == null) ? '' : ' (' + (pct > 0 ? '+' : '') + pctFmt(pct, 1) + ')';
  if(d > 0.005)  return 'Neste cenário, a carga mensal sobre consumo <b>aumenta</b> em ' + money(d) + sufixo + '.';
  if(d < -0.005) return 'Neste cenário, a carga mensal sobre consumo <b>reduz</b> em ' + money(Math.abs(d)) + sufixo + '.';
  return 'Neste cenário, a carga mensal sobre consumo <b>permanece próxima</b> da situação atual.';
}

function renderResultado(R, P){
  var det = (P && P.atualDetalhe) || {};
  $('rAnoLabel').textContent = R.ano;
  if($('anoResultado').value !== String(R.ano)){
    $('anoResultado').value = String(R.ano);
    sincronizarSeletorCustom($('anoResultado'));
  }

  // mensagem executiva + destaque de leitura
  var cls = R.diferencaMes > 0.005 ? 'exec up' : (R.diferencaMes < -0.005 ? 'exec down' : 'exec');
  $('rExec').className = cls;
  $('rExec').innerHTML =
    '<div class="exec-t">' + fraseExecutiva(R) + '</div>' +
    '<div class="exec-s">Ano analisado: <b>' + R.ano + '</b> · Carga atual de consumo: <b>' + money(R.consumoAtual) +
    '</b> · Carga projetada: <b>' + money(R.consumoReforma) + '</b> por mês.</div>';
  $('rRefSub').innerHTML = 'IBS '+pctFmt(R.aliquotas.ibs)+' · CBS '+pctFmt(R.aliquotas.cbs)+' — '+
    STATUS[R.aliquotas.statusIbs].rotulo.toLowerCase()+' / '+STATUS[R.aliquotas.statusCbs].rotulo.toLowerCase();

  /* A · situação atual */
  $('rAtualTot').textContent = money(R.atual.total);
  var a = '';
  componentesPisCofins(R, P).forEach(function(c){
    a += linhaComOrigem(c.rotulo, c.valor, c.combinado ? det.pisCofins : c.det);
  });
  componentesLegados(R, P, false).forEach(function(c){
    a += linhaComOrigem(c.rotulo, c.valor, c.det);
  });
  a += linha('Total atual', money(R.atual.total), 'tot');
  $('rAtualBody').innerHTML = a;
  var nOp = (P && P.atualDetalhado) ? P.atualDetalhado.linhas.length : 0;
  var plural = (nOp === 1 ? ' operação' : ' operações');
  $('rAtualSub').innerHTML = (P && P.currentRevenueMode === 'DETAILED' && P.atualDetalhado)
    ? (P.revenueModelUnified
        ? ('Formada pelo detalhamento unificado de ' + nOp + plural)
        : ('Situação atual formada pelo detalhamento de ' + nOp + plural))
    : 'Valores informados por você como média histórica';

  /* A · cenário Reforma */
  $('rRefTot').textContent = money(R.consumoReforma);
  var b = '';
  b += linha('IBS — débito', money(R.debito.ibs));
  b += linha('CBS — débito', money(R.debito.cbs));
  b += linha('(−) Crédito utilizável estimado de IBS/CBS', '−' + money(R.credito.total), 'cred');
  if(R.estorno.aplicavel){
    b += linha('Crédito potencial bruto', money(R.creditoBruto.total), 'sub');
    b += linha('Estorno por isenção/imunidade ('+pctFmt(R.estorno.percentualEstorno)+')', '−' + money(R.estorno.estorno.total), 'sub');
  }
  if(R.liquido.saldoCredorTotal > 0){
    b += linha('Saldo credor estimado no mês', money(R.liquido.saldoCredorTotal), 'sub cred');
  }
  b += linha('ICMS remanescente ('+pctFmt(R.legado.fatorIcms,0)+')', money(R.legado.icms));
  b += linha('ISS remanescente ('+pctFmt(R.legado.fatorIss,0)+')', money(R.legado.iss));
  if(R.legado.ipi > 0) b += linha('IPI residual / ZFM', money(R.legado.ipi));
  else b += linha('IPI', money(0), 'muted');
  if(R.seletivo.aplicavel) b += linha('Imposto Seletivo' + (R.seletivo.status==='PENDING_LAW' ? ' (sem alíquota informada)' : ' ('+pctFmt(R.seletivo.aliquota)+')'), money(R.seletivo.valor));
  b += linha('PIS/Cofins', 'extintos', 'muted');
  b += linha('Total projetado', money(R.consumoReforma), 'tot');
  $('rRefBody').innerHTML = b;

  /* comparativo */
  var sobe = R.diferencaMes > 0.005, desce = R.diferencaMes < -0.005;
  var cls = sobe ? 'cbox up' : (desce ? 'cbox down' : 'cbox');
  $('cxMes').className = cls; $('cxAno').className = cls; $('cxPct').className = cls;
  var sinal = R.diferencaMes > 0 ? '+' : '';
  $('rDifMes').textContent = sinal + money(R.diferencaMes);
  $('rDifAno').textContent = sinal + money(R.diferencaAno);
  $('rDifPct').textContent = R.diferencaPct == null ? 'não aplicável' : (R.diferencaPct > 0 ? '+' : '') + pctFmt(R.diferencaPct, 1);

  /* B · carga sobre o faturamento */
  var C = calculateTaxBurdenBreakdown(R, P);
  $('rCarga').innerHTML = tabelaCarga(C);
  $('rCargaMemo').innerHTML = memoriaCarga(C);
  $('rCargaNota').innerHTML = notaCarga(C);

  /* C · visão completa */
  var c = R.complementar;
  var vc = '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Componente</th><th>Situação atual</th><th>Cenário '+R.ano+'</th><th>Diferença</th></tr></thead><tbody>';
  vc += '<tr><td>Tributos sobre consumo</td><td>'+money(R.atual.total)+'</td><td>'+money(R.consumoReforma)+'</td><td>'+money(R.diferencaMes)+'</td></tr>';
  componentesIrpjCsll(P, R).forEach(function(x){
    vc += '<tr><td>'+esc(x.rotulo)+' '+tagStatus('HISTORICAL')+'</td><td>'+money(x.mensal)+'</td><td>'+money(x.mensal)+'</td><td>'+money(0)+'</td></tr>';
  });
  vc += '<tr><td>Encargos patronais '+tagStatus('HISTORICAL')+'</td><td>'+money(c.encargosPatronais)+'</td><td>'+money(c.encargosPatronais)+'</td><td>'+money(0)+'</td></tr>';
  vc += '<tr><td>Encargos de pró-labore '+tagStatus('HISTORICAL')+'</td><td>'+money(c.encargosProLabore)+'</td><td>'+money(c.encargosProLabore)+'</td><td>'+money(0)+'</td></tr>';
  vc += '</tbody><tfoot><tr><td>Carga completa considerada (mês)</td><td>'+money(R.completaAtual)+'</td><td>'+money(R.completaReforma)+'</td><td>'+money(R.completaReforma-R.completaAtual)+'</td></tr>';
  vc += '<tr><td>Carga completa considerada (ano)</td><td>'+money(R.completaAtual*12)+'</td><td>'+money(R.completaReforma*12)+'</td><td>'+money((R.completaReforma-R.completaAtual)*12)+'</td></tr></tfoot></table></div>';
  $('rVisaoCompleta').innerHTML = vc;

  /* C · créditos */
  $('rCreditos').innerHTML = tabelaCreditos(R) + memoriaIbsCbs(R) + explicacaoEstorno(R, false) + blocoOrigemCreditos(R);
  $('rAtualDetalhe').innerHTML = tabelaSituacaoAtualDetalhada(P);
  $('rMemoAtual').innerHTML = memoriaSituacaoEReforma(R, P);

  var nota = 'O débito sai de cada linha de receita multiplicada pela sua alíquota efetiva do ano, conforme a memória de cálculo abaixo. ';
  if(R.modoCompras === 'DETAILED'){
    var dc = R.comprasDetalhe;
    nota += 'Compras totais: <b>'+money(dc.totalCompras)+'</b>. Compras classificadas: <b>'+money(dc.comprasClassificadas)+
      '</b>. Compras não classificadas: <b>'+money(dc.comprasNaoClassificadas)+
      '</b>. O crédito bruto foi calculado individualmente conforme o tratamento de cada grupo. ';
  } else {
    nota += 'Base estimada de compras creditáveis ('+money(R.creditoBruto.compras != null ? R.creditoBruto.compras : 0)+
      ' × '+pctFmt(R.creditoBruto.pct,0)+'): <b>'+money(R.creditoBruto.base)+'</b>. ';
  }
  nota += 'O crédito é <b>potencial estimado</b>, não crédito fiscal definitivo.';
  if(R.liquido.saldoCredorTotal > 0){
    nota += ' <b>Atenção:</b> nesta simulação o crédito utilizável supera o débito e há saldo credor estimado de <b>'+money(R.liquido.saldoCredorTotal)+
      '</b> no mês. O saldo credor não foi zerado: ele aparece na linha própria e não reduz os demais tributos do cenário.';
  }
  $('rCreditosNota').innerHTML = nota;
}

/* D · trajetória */
function renderTrajetoria(T, anoSelecionado, P){
  var h = '<thead><tr><th>Ano</th><th>Consumo — atual</th><th>Consumo — Reforma</th><th>Impacto no consumo</th>'+
          '<th>Carga tributária</th><th>% do faturamento</th><th>Carga completa considerada</th><th>Impacto total</th></tr></thead><tbody>';
  T.forEach(function(R){
    var d = R.diferencaMes, dt = R.completaReforma - R.completaAtual;
    var cargaAno = P ? calculateTaxBurdenBreakdown(R, P).reforma.tributaria : {valor:0,pct:null};
    var cd = d > 0.005 ? 'up' : (d < -0.005 ? 'down' : 'muted');
    var ct = dt > 0.005 ? 'up' : (dt < -0.005 ? 'down' : 'muted');
    h += '<tr'+(String(R.ano)===String(anoSelecionado)?' class="sel-year"':'')+'>'+
      '<td class="yr">'+R.ano+'</td>'+
      '<td>'+money(R.consumoAtual)+'</td>'+
      '<td>'+money(R.consumoReforma)+'</td>'+
      '<td class="'+cd+'">'+(d>0?'+':'')+money(d)+'</td>'+
      '<td>'+money(cargaAno.valor)+'</td>'+
      '<td>'+(cargaAno.pct==null?'não aplicável':pctFmt(cargaAno.pct))+'</td>'+
      '<td>'+money(R.completaReforma)+'</td>'+
      '<td class="'+ct+'">'+(dt>0?'+':'')+money(dt)+'</td></tr>';
  });
  h += '</tbody>';
  $('rTrajetoria').innerHTML = h;
  $('rGrafico').innerHTML = graficoLinha(T, anoSelecionado, true);
  ligarTooltipGrafico($('rGrafico'), T, P);
}

/* anoFoco marca o ano do relatório; interativo só é ligado no gráfico da TELA.
   Nos dois relatórios o gráfico é estático: nem as áreas sensíveis são geradas. */
function graficoLinha(T, anoFoco, interativo){
  var W=680, H=300, L=88, Rp=18, Tp=18, B=44;
  var plotW = W-L-Rp, plotH = H-Tp-B, base = Tp+plotH;
  var series = [
    { cor:'#1a1a1a', dados:T.map(function(R){ return R.consumoAtual; }) },
    { cor:'#5c0a0a', dados:T.map(function(R){ return R.consumoReforma; }) },
    { cor:'#21867a', dados:T.map(function(R){ return R.completaReforma; }) }
  ];
  var todos = [];
  series.forEach(function(s){ s.dados.forEach(function(v){ todos.push(v); }); });
  var max = Math.max.apply(null, todos.concat([0])) || 1;
  function xx(i){ return L + (T.length===1 ? 0 : i/(T.length-1)*plotW); }
  function yy(v){ return Tp + plotH - (v/max)*plotH; }

  var s = '<svg class="chart" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI,Arial,sans-serif">';
  [0,0.25,0.5,0.75,1].forEach(function(f){
    var v = max*f, gy = yy(v);
    s += '<line x1="'+L+'" y1="'+gy.toFixed(1)+'" x2="'+(W-Rp)+'" y2="'+gy.toFixed(1)+'" stroke="#eef0f7"/>';
    s += '<text x="'+(L-8)+'" y="'+(gy+4).toFixed(1)+'" text-anchor="end" font-size="11" fill="#7f8083">'+money(v)+'</text>';
  });
  // o ano do relatório recebe marca vertical e rótulo em destaque — a leitura
  // não depende só da cor: o rótulo fica em negrito escuro e ganha sublinhado
  T.forEach(function(R,i){
    var foco = (anoFoco != null && String(R.ano) === String(anoFoco));
    if(foco){
      s += '<line x1="'+xx(i).toFixed(1)+'" y1="'+Tp+'" x2="'+xx(i).toFixed(1)+'" y2="'+base+
           '" stroke="#5c0a0a" stroke-width="1.2" stroke-dasharray="4 3" opacity=".55"/>';
      s += '<rect x="'+(xx(i)-20).toFixed(1)+'" y="'+(base+8)+'" width="40" height="16" rx="8" fill="#e6ecf6"/>';
    }
    s += '<text x="'+xx(i).toFixed(1)+'" y="'+(base+20)+'" text-anchor="middle" font-size="11.5" font-weight="'+
         (foco?'800':'600')+'" fill="'+(foco?'#5c0a0a':'#707070')+'">'+R.ano+'</text>';
  });
  series.forEach(function(se){
    var pts = se.dados.map(function(v,i){ return xx(i).toFixed(1)+','+yy(v).toFixed(1); });
    s += '<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+se.cor+'" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    se.dados.forEach(function(v,i){
      s += '<circle cx="'+xx(i).toFixed(1)+'" cy="'+yy(v).toFixed(1)+'" r="3.4" fill="'+se.cor+'"/>';
    });
  });
  // faixa sensível por ano: cobre toda a altura e responde a mouse e toque
  if(interativo) T.forEach(function(R,i){
    var meia = T.length > 1 ? (plotW/(T.length-1))/2 : plotW;
    var x0 = Math.max(L, xx(i)-meia);
    var larg = Math.min(W-Rp, xx(i)+meia) - x0;
    s += '<rect class="pt-hit" data-i="'+i+'" x="'+x0.toFixed(1)+'" y="'+Tp+'" width="'+larg.toFixed(1)+'" height="'+plotH+'" fill="transparent" style="cursor:pointer"/>';
  });
  return s + '</svg>';
}

/** tooltip do gráfico da trajetória. Mostra apenas números que já existem na
    trajetória e na carga já calculada — nenhuma conta nova. */
function ligarTooltipGrafico(container, T, P){
  if(!container) return;
  var svg = container.querySelector('svg');
  if(!svg) return;
  var tip = document.createElement('div');
  tip.className = 'graf-tip';
  tip.setAttribute('role','status');
  container.style.position = 'relative';
  container.appendChild(tip);

  function mostrar(i, alvo){
    var R = T[i];
    if(!R) return;
    var carga = P ? calculateTaxBurdenBreakdown(R, P).reforma : null;
    var h = '<div class="gt-ano">' + R.ano + '</div>';
    h += '<div class="gt-l"><span>Consumo atual</span><b>' + money(R.consumoAtual) + '</b></div>';
    h += '<div class="gt-l"><span>Consumo Reforma</span><b>' + money(R.consumoReforma) + '</b></div>';
    if(carga){
      h += '<div class="gt-l"><span>Carga tributária</span><b>' + money(carga.tributaria.valor) + '</b></div>';
      if(carga.tributaria.pct != null){
        h += '<div class="gt-l"><span>% do faturamento</span><b>' + pctFmt(carga.tributaria.pct) + '</b></div>';
      }
    }
    h += '<div class="gt-l"><span>Carga completa</span><b>' + money(R.completaReforma) + '</b></div>';
    tip.innerHTML = h;
    tip.classList.add('on');
    var cx = alvo.getBoundingClientRect(), cc = container.getBoundingClientRect();
    var x = cx.left - cc.left + cx.width/2 - tip.offsetWidth/2;
    x = Math.max(6, Math.min(x, cc.width - tip.offsetWidth - 6));
    tip.style.left = Math.round(x) + 'px';
    tip.style.top = '6px';
  }
  function esconder(){ tip.classList.remove('on'); }

  Array.prototype.forEach.call(svg.querySelectorAll('.pt-hit'), function(area){
    var i = +area.getAttribute('data-i');
    area.addEventListener('mouseenter', function(){ mostrar(i, area); });
    area.addEventListener('mouseleave', esconder);
    area.addEventListener('click', function(e){ e.stopPropagation(); mostrar(i, area); });
    area.addEventListener('touchstart', function(e){ e.stopPropagation(); mostrar(i, area); }, {passive:true});
  });
  container.addEventListener('mouseleave', esconder);
  document.addEventListener('click', function(e){ if(!container.contains(e.target)) esconder(); });
}

/* premissas utilizadas — tabela de transparência */
function listaPremissasUsadas(P, R){
  var r = FISCAL_RULES.anos[R.ano];
  var itens = [];
  function add(rot, val, status, fonte, obs, campoId){
    itens.push({ rotulo:rot, valor:val, status:status, fonte:fonte, obs:obs||'', campoId:campoId||null });
  }
  // campos da situacao atual so sao editaveis quando o modo simples esta ativo
  var editAtual = (P.currentRevenueMode !== 'DETAILED');
  add('IBS — alíquota de '+R.ano, pctFmt(r.ibs.valor), r.ibs.status, r.ibs.fonte, r.ibs.descricao, 'prem_'+R.ano+'_ibs');
  add('CBS — alíquota de '+R.ano, pctFmt(r.cbs.valor), r.cbs.status, r.cbs.fonte, obsCbsDoAno(R.ano), 'prem_'+R.ano+'_cbs');
  add('ICMS remanescente em '+R.ano, pctFmt(r.icmsRemanescente.valor,0), r.icmsRemanescente.status, r.icmsRemanescente.fonte, r.icmsRemanescente.descricao, 'prem_'+R.ano+'_icmsRemanescente');
  add('ISS remanescente em '+R.ano, pctFmt(r.issRemanescente.valor,0), r.issRemanescente.status, r.issRemanescente.fonte, r.issRemanescente.descricao, 'prem_'+R.ano+'_issRemanescente');
  add('IPI mantido em '+R.ano, pctFmt(r.ipiPadrao.valor,0), r.ipiPadrao.status, r.ipiPadrao.fonte, r.ipiPadrao.descricao, 'prem_'+R.ano+'_ipiPadrao');
  add('PIS/Cofins em '+R.ano, 'extintos no cenário Reforma', 'LEGAL_FIXED', 'EC132', 'Deixam de compor o cenário a partir de 2027.');
  var lp = FISCAL_RULES.longoPrazo;
  add('Alíquota-padrão conjunta (referência)', pctFmt(lp.aliquotaPadraoConjunta.valor), lp.aliquotaPadraoConjunta.status, lp.aliquotaPadraoConjunta.fonte, lp.aliquotaPadraoConjunta.descricao);
  add('IBS cheio estimado (referência)', pctFmt(lp.ibsCheio.valor), lp.ibsCheio.status, lp.ibsCheio.fonte, lp.ibsCheio.descricao);
  add('CBS cheia utilizada (referência)', pctFmt(lp.cbsCheia.valor), lp.cbsCheia.status, lp.cbsCheia.fonte, obsCbsReferencia());

  add('Faturamento médio mensal', money(P.faturamento), 'USER_INPUT', null, '', 'faturamento');
  add('Compras médias mensais', money(P.compras), 'USER_INPUT', null, '', 'compras');
  if(R.modoCompras === 'DETAILED'){
    add('Modo de créditos das compras', 'Detalhado por grupo de aquisição', 'USER_INPUT', null,
        'O crédito bruto vem exclusivamente dos grupos informados. O percentual creditável simplificado não é utilizado neste modo.');
    var d = R.comprasDetalhe;
    add('Compras classificadas', money(d.comprasClassificadas), 'USER_INPUT', null,
        'Soma das bases estimadas dos grupos de aquisição informados.');
    add('Compras não classificadas', money(d.comprasNaoClassificadas), 'USER_INPUT', null,
        'Sem crédito no modo detalhado enquanto não forem classificadas.');
    d.linhas.forEach(function(l){
      var obs = 'Classificação informada pelo usuário. ' + (l.ruleRotulo || '') + '. ' + l.detalheFator +
                '. Crédito estimado: IBS ' + money(l.creditoIbs) + ' · CBS ' + money(l.creditoCbs);
      if(l.legacySimpleCreditNeedsReview){
        obs += '. Grupo salvo no modelo anterior de fatores: crédito considerado zero até a revisão das alíquotas efetivas.';
      } else if(l.semFatorInformado){
        obs += l.tipo === 'SIMPLES'
          ? '. Alíquotas efetivas de crédito do Simples não informadas: crédito considerado zero neste grupo.'
          : '. Fatores não informados: crédito zero.';
      } else { obs += '.'; }
      add('Grupo de compras: ' + l.descricao,
          money(l.valor) + ' — ' + l.tipoRotulo,
          l.ruleStatus, l.fonte, obs);
    });
  } else {
    add('Modo de créditos das compras', 'Estimativa simplificada', 'USER_INPUT', null,
        'Compras × percentual creditável × alíquota do ano.');
    add('Compras que geram crédito', pctFmt(P.pctCreditavel,0), 'USER_INPUT', null,
        'Aplicado sobre as compras para obter a base de crédito potencial bruto. Estimativa do mix de aquisições informada por você.', 'pctCreditavel');
  }
  // regra de crédito de cada tratamento efetivamente usado no período
  var usados = {};
  (R.tratamento.linhas || []).forEach(function(l){ usados[l.tratamento] = true; });
  FISCAL_RULES.tratamentosReceita.forEach(function(t){
    if(!usados[t.id]) return;
    add('Tratamento de saída: ' + t.rotulo,
        t.creditTreatment === 'PROPORTIONAL_REVERSAL' ? 'Anulação proporcional dos créditos' : 'Mantém os créditos anteriores',
        t.creditTreatment === 'PROPORTIONAL_REVERSAL' ? 'LEGAL_FIXED' : 'LEGAL_FIXED',
        t.fonte, t.ajuda || '');
  });
  if(R.estorno.aplicavel){
    add('Percentual estimado de estorno de créditos', pctFmt(R.estorno.percentualEstorno), 'DERIVED_ESTIMATE', 'LC214',
        'Receitas sujeitas à anulação proporcional (' + money(R.estorno.receitaEstorno) + ') dividido pela receita total (' +
        money(R.estorno.receitaTotal) + '). Aplicado separadamente ao IBS e à CBS.');
  }
  add('Vendas B2B', pctFmt(P.pctB2B,0), 'USER_INPUT', null, 'Informativo. Não altera o imposto devido pela empresa.', 'pctB2B');
  if(P.revenueModelUnified){
    add('Modelo de detalhamento de receitas', 'Unificado por operação', 'USER_INPUT', null,
        'Cada linha informa os tributos atuais da operação e o tratamento de IBS/CBS considerado. ' +
        'O campo simplificado de exportações e a redução geral não participam neste modelo.');
    add('Exportações', 'Identificadas nas linhas de receita', 'USER_INPUT', null,
        'No modelo unificado a exportação vem do tratamento escolhido em cada operação, não de um percentual global.');
  } else {
    if(P.currentRevenueMode === 'DETAILED'){
      add('Modelo de detalhamento de receitas', 'Separado (modelo anterior)', 'USER_INPUT', null,
          'Cliente salvo antes da unificação. O cálculo é o mesmo de antes; a consolidação é manual.');
    }
    add('Exportações', pctFmt(P.pctExportacao,0), 'USER_INPUT', null, 'Imunidade: não gera débito de IBS/CBS no simulador.', 'pctExportacao');
  }
  if(P.reducaoGeral > 0) add('Redução geral de alíquota IBS/CBS', pctFmt(P.reducaoGeral,0), 'USER_CUSTOM', null, 'Aplicada sobre a alíquota da receita integral.', 'reducaoGeral');

  // tributos atuais: valor + modo de entrada + base/alíquota quando calculado
  var dt = P.atualDetalhe || {};
  function addTributoAtual(rot, valor, det, campoId){
    var d = det || { modo:'VALUE', origemStatus:'HISTORICAL' };
    add(rot, money(valor), d.origemStatus || 'HISTORICAL', null, textoOrigem(d), editAtual ? campoId : null);
  }
  componentesPisCofins({ atual:P.atual }, P).forEach(function(c){
    var d = c.det || { modo:'VALUE', origemStatus:'HISTORICAL' };
    var obs = (d.modo === 'RATE' && d.base != null)
      ? ('Base ' + money(d.base) + ' × alíquota ' + pctFmt(d.aliquota) +
         '. Estimativa por base × alíquota, sem considerar automaticamente créditos da não cumulatividade.')
      : (c.combinado
          ? 'Valor combinado preservado do registro anterior. Informe PIS e Cofins separadamente para detalhar.'
          : textoOrigem(d));
    add(c.rotulo + ' atual', money(c.valor), d.origemStatus || 'HISTORICAL', null, obs,
        editAtual ? c.campoId : null);
  });
  addTributoAtual('ICMS atual', P.atual.icms, dt.icms, 'atualIcms');
  addTributoAtual('ISS atual', P.atual.iss, dt.iss, 'atualIss');
  addTributoAtual('IPI atual', P.atual.ipi, dt.ipi, 'atualIpi');
  componentesIrpjCsll(P, { complementar:P.complementar }).forEach(function(c){
    // no trimestral o botão leva ao campo do valor trimestral daquele tributo
    add(c.rotulo, money(c.mensal), 'HISTORICAL', null, origemIrpjCsll(c), c.campoId);
  });
  add('Encargos patronais', money(P.complementar.encargosPatronais), 'HISTORICAL', null, 'Média mensal informada. Não recalculada pela ferramenta.', 'encargosPatronais');
  add('Encargos de pró-labore', money(P.complementar.encargosProLabore), 'HISTORICAL', null, 'Média mensal informada. Não recalculada pela ferramenta.', 'encargosProLabore');

  if(P.ipiResidual.ativo) add('IPI residual / ZFM', money(P.ipiResidual.valor), 'USER_CUSTOM', null, 'Habilitado manualmente nas premissas avançadas.', 'ipiResidualValor');

  if(P.impostoSeletivo.sujeita){
    var cat = null;
    FISCAL_RULES.impostoSeletivo.categorias.forEach(function(c){ if(c.id===P.impostoSeletivo.categoria) cat = c; });
    add('Imposto Seletivo — categoria', cat ? cat.rotulo : '—', 'USER_INPUT', 'LC214', '');
    add('Imposto Seletivo — base mensal', money(P.impostoSeletivo.base), 'USER_INPUT', null, '', 'isBase');
    add('Imposto Seletivo — alíquota',
        P.impostoSeletivo.usarCustom ? pctFmt(P.impostoSeletivo.aliquota) : 'não informada',
        P.impostoSeletivo.usarCustom ? 'USER_CUSTOM' : 'PENDING_LAW', 'LC214',
        P.impostoSeletivo.usarCustom
          ? 'Percentual hipotético informado apenas para esta simulação.'
          : 'Sem alíquota definida em norma para uso automático: o IS permanece em R$ 0,00.');
    if(cat && cat.limiteMaximo){
      add('Imposto Seletivo — limite máximo da categoria', pctFmt(cat.limiteMaximo.valor), cat.limiteMaximo.status, cat.limiteMaximo.fonte, cat.limiteMaximo.descricao);
    }
  }
  return itens;
}

function tabelaPremissas(itens, interativa){
  var h = '<thead><tr><th>Premissa</th><th>Valor</th><th>Origem</th><th>Fonte registrada</th></tr></thead><tbody>';
  itens.forEach(function(it){
    // só vira botão a premissa que realmente tem campo editável em "Refinar premissas"
    var editavel = interativa && it.campoId && document.getElementById(it.campoId);
    var rot = esc(it.rotulo);
    if(editavel){
      rot = '<button type="button" class="prem-edit" data-campo="'+esc(it.campoId)+'">' +
            rot + '<span class="prem-lapis" aria-hidden="true">✎</span><span class="prem-txt">Editar</span></button>';
    }
    h += '<tr><td>'+rot+(it.obs?'<div style="font-weight:400;color:#7f8083;font-size:.8rem;margin-top:3px">'+esc(it.obs)+'</div>':'')+'</td>'+
         '<td>'+esc(it.valor)+'</td>'+
         '<td>'+tagStatus(it.status)+'</td>'+
         '<td>'+esc(rotuloFonte(it.fonte))+'</td></tr>';
  });
  return h + '</tbody>';
}

/** leva o usuário direto ao campo da premissa: abre o refinamento, rola,
    dá foco e destaca por ~1,8s. Nunca altera o valor. */
function irParaPremissa(campoId){
  var el = document.getElementById(campoId);
  if(!el) return;
  // abre todos os blocos recolhidos que contenham o campo
  var p = el.parentElement;
  while(p){
    if(p.tagName === 'DETAILS' && !p.open) p.open = true;
    if(p.classList && p.classList.contains('hidden')) p.classList.remove('hidden');
    p = p.parentElement;
  }
  el.scrollIntoView({ behavior:'smooth', block:'center' });
  setTimeout(function(){
    try { el.focus({ preventScroll:true }); } catch(e){ try{ el.focus(); }catch(e2){} }
    if(el.select) { try { el.select(); } catch(e){} }
  }, 320);
  el.classList.add('prem-alvo');
  if(irParaPremissa._t) clearTimeout(irParaPremissa._t);
  irParaPremissa._t = setTimeout(function(){ el.classList.remove('prem-alvo'); }, 1800);
}

/** liga os botões da tabela de premissas da TELA (o relatório não é interativo) */
function ligarPremissasClicaveis(){
  var box = $('rPremissas');
  if(!box) return;
  Array.prototype.forEach.call(box.querySelectorAll('.prem-edit'), function(b){
    b.addEventListener('click', function(){ irParaPremissa(this.getAttribute('data-campo')); });
  });
}

/* =====================================================================
   SIMULAR
   ===================================================================== */
function simular(){
  var P = coletarDados();

  /* Ordem dos fail closed.
     No modelo unificado, a receita classificada é exatamente a soma das linhas
     unificadas — a mesma grandeza que a reconciliação já verifica, e com a
     tolerância de R$ 0,01 definida para este modelo. Rodar as duas checagens
     sobre a mesma grandeza com tolerâncias diferentes (0,005 e 0,01) faria a
     mensagem errada aparecer numa janela de um centavo. Por isso, no modelo
     unificado a verificação é feita UMA vez, pela reconciliação; o validador
     de classificação continua valendo integralmente nos demais modos. */
  var uni = !!P.revenueModelUnified;

  /* fail closed: agregado legado ainda não separado.
     Vem antes das demais checagens porque, sem a separação, os tributos atuais
     do cliente simplesmente não existem no modelo atual da ferramenta. */
  var VM = validarMigracoesPendentes(P);
  if(!VM.valido){
    mostrarBloqueioMigracao(VM);
    return null;
  }
  // fail closed: no modo detalhado o faturamento das linhas tem de fechar
  var VR = validateDetailedCurrentRevenue(P);
  if(!VR.valido){
    mostrarBloqueioReceitaAtual(VR);
    return null;
  }
  /* fail closed: linha unificada ainda no modelo combinado de PIS/Cofins.
     Mesma decisão dos campos gerais — a operação precisa ser revisada antes de
     produzir simulação definitiva. */
  var VL = validarLinhasCombinadas(P);
  if(!VL.valido){
    mostrarBloqueioLinhasCombinadas(VL);
    return null;
  }
  // fail closed: no modelo unificado toda linha precisa de tratamento escolhido
  var VU = validateUnifiedTreatments(P);
  if(!VU.valido){
    mostrarBloqueioTratamento(VU);
    return null;
  }
  // fail closed: receita classificada acima do faturamento invalida o cenário
  var V = validateRevenueClassification(P);
  if(!uni && !V.valido){
    mostrarBloqueio(V);
    return null;
  }
  // fail closed: grupos de compras acima do total de compras também invalidam
  var VC = validatePurchaseClassification(P);
  if(!VC.valido){
    mostrarBloqueioCompras(VC);
    return null;
  }
  limparBloqueio();

  var ano = $('ano').value;
  var R = calculateYearScenario(P, FISCAL_RULES, ano);
  var T = calculateTrajectory(P, FISCAL_RULES);
  ultimoResultado = { P:P, R:R, ano:ano, validacao:V };
  ultimaTrajetoria = T;

  renderResultado(R, P);
  renderTrajetoria(T, ano, P);
  $('rPremissas').innerHTML = tabelaPremissas(listaPremissasUsadas(P, R), true);
  ligarPremissasClicaveis();
  $('resultado').className = 'on';
  return R;
}

/* =====================================================================
   RELATÓRIO
   ===================================================================== */
/* =====================================================================
   RELATÓRIOS — CAMADA DE APRESENTAÇÃO
   ---------------------------------------------------------------------
   Dois documentos sobre a MESMA simulação:
     REPRESENTATIVE  resumo executivo para apresentar ao cliente;
     CALCULATIONS    memória técnica completa, auditável.

   Regra de arquitetura: nenhum relatório recalcula tributo. Tudo vem de
   P (dados normalizados), R (cenário do ano) e T (trajetória), além dos
   helpers de apresentação já validados. Não existe segundo motor.
   ===================================================================== */
var reportMode = 'CALCULATIONS';

function montarRelatorio(modo){
  reportMode = (modo === 'REPRESENTATIVE' || modo === 'FULL_TRANSITION') ? modo : 'CALCULATIONS';

  /* O relatório sempre reflete o ESTADO ATUAL do formulário e do seletor de ano.
     Reaproveitar um ultimoResultado antigo geraria documento com dados obsoletos
     e ignoraria uma validação que passou a falhar depois da última simulação.
     simular() executa todos os fail closed já existentes e, ao bloquear, zera
     ultimoResultado — nenhum relatório é montado a partir daí. */
  simular();
  if(!ultimoResultado || !ultimaTrajetoria) return false;

  var P = ultimoResultado.P, R = ultimoResultado.R, T = ultimaTrajetoria;
  var Crp = calculateTaxBurdenBreakdown(R, P);

  $('report').setAttribute('data-modo', reportMode);
  montarCabecalhoRelatorio(P, R);
  montarResumoExecutivo(R, Crp);

  // o corpo dos modos inativos é esvaziado: nada do documento anterior sobra
  if(reportMode === 'REPRESENTATIVE'){
    $('rp_full').innerHTML = '';
    montarCorpoRepresentativo(P, R, T, Crp);
  } else if(reportMode === 'FULL_TRANSITION'){
    $('rp_rep').innerHTML = '';
    montarCorpoCompleto(P, R, T, Crp);
  } else {
    $('rp_rep').innerHTML = '';
    $('rp_full').innerHTML = '';
    montarCorpoCalculos(P, R, T, Crp);
  }

  montarRodapeRelatorio(P, R);
  return true;
}

/* ---------------- cabeçalho, identificação e rodapé (compartilhados) ---------------- */
function montarCabecalhoRelatorio(P, R){
  var seg = null;
  FISCAL_RULES.segmentos.forEach(function(s){ if(s.id === P.segmento) seg = s; });

  // identificação do escritório — configuração global, não altera nenhum cálculo
  $('rp_esc').textContent = escTexto('nome') || 'Contabiliza';
  var infoEsc = [];
  if(escTexto('cnpj')) infoEsc.push('<span><b>CNPJ:</b> ' + esc(escTexto('cnpj')) + '</span>');
  if(escTexto('registro')) infoEsc.push('<span>' + esc(escTexto('registro')) + '</span>');
  if(escTexto('contato')) infoEsc.push('<span>' + esc(escTexto('contato')) + '</span>');
  $('rp_escinfo').innerHTML = infoEsc.join('');
  var boxLogo = $('rp_logo');
  if(escritorio.logo){ boxLogo.className = 'rp-logo on'; boxLogo.innerHTML = '<img alt="Logomarca" src="' + escritorio.logo + '">'; }
  else { boxLogo.className = 'rp-logo'; boxLogo.innerHTML = ''; }

  $('rp_tipo').textContent =
    (reportMode === 'REPRESENTATIVE') ? 'Relatório executivo · Resumo da simulação' :
    (reportMode === 'FULL_TRANSITION') ? 'Relatório completo da transição 2027–2033' :
    'Relatório com cálculos · Memória técnica';

  $('rp_cliente').textContent = P.empresa || $('clientName').value.trim() || 'Não informado';
  $('rp_cnpj').textContent = P.cnpj || 'Não informado';
  $('rp_seg').textContent = seg ? seg.rotulo : '—';
  // no completo o documento não pertence a um ano: cobre a trajetória inteira
  $('rp_ano').textContent = (reportMode === 'FULL_TRANSITION')
    ? (FISCAL_RULES.meta.anos[0] + ' a ' + FISCAL_RULES.meta.anos[FISCAL_RULES.meta.anos.length - 1])
    : R.ano;
  $('rp_data').textContent = new Date().toLocaleDateString('pt-BR');
}

function montarRodapeRelatorio(P, R){
  $('rp_foot').innerHTML =
    'Simulação com base nos dados e premissas informados. Não substitui apuração, escrituração nem análise específica das operações. ' +
    'Alíquotas de IBS e CBS marcadas como estimativa ou projeção não são valores definitivos. Premissas Contabiliza com data-base de ' +
    dataBaseBR() + '. Fontes: ' +
    Object.keys(FISCAL_RULES.fontes).map(function(k){ return FISCAL_RULES.fontes[k].rotulo; }).join(' · ') + '.';

  var nome = (reportMode === 'REPRESENTATIVE') ? 'Relatório executivo' :
             (reportMode === 'FULL_TRANSITION') ? 'Relatório completo 2027–2033' : 'Relatório com cálculos';
  var periodo = (reportMode === 'FULL_TRANSITION')
    ? (FISCAL_RULES.meta.anos[0] + '–' + FISCAL_RULES.meta.anos[FISCAL_RULES.meta.anos.length - 1])
    : R.ano;
  $('rp_rodape').innerHTML =
    '<span>Contabiliza · Lucro Real · ' + esc(nome) + '</span>' +
    '<span>' + esc(P.empresa || 'Cliente não informado') + ' · ' + periodo +
    ' · ' + new Date().toLocaleDateString('pt-BR') + '</span>';
}

/* ---------------- resumo executivo (compartilhado, com ênfase por modo) ---------------- */
function montarResumoExecutivo(R, C){
  var sobe = R.diferencaMes > 0.005, desce = R.diferencaMes < -0.005;
  var clsKpi = sobe ? 'kpi kpi-up' : (desce ? 'kpi kpi-down' : 'kpi');
  var pctTxt = (R.diferencaPct == null) ? 'não aplicável'
             : ((R.diferencaPct > 0 ? '+' : '') + pctFmt(R.diferencaPct, 1));

  $('rp_exec').className = 'rp-exec' + (sobe ? ' up' : (desce ? ' down' : ''));
  $('rp_exec').innerHTML =
    '<div class="rp-exec-l">Resumo executivo</div>' +
    '<div class="rp-exec-t">' + fraseExecutiva(R) + '</div>' +
    '<div class="rp-exec-g">' +
      '<span><b>Carga atual de consumo</b>' + money(R.consumoAtual) + ' / mês</span>' +
      '<span><b>Carga projetada em ' + R.ano + '</b>' + money(R.consumoReforma) + ' / mês</span>' +
      '<span><b>Carga completa considerada</b>' + money(R.completaReforma) + ' / mês</span>' +
    '</div>';

  var k = '';
  k += '<div class="' + clsKpi + '"><div class="kpi-l">Impacto mensal no consumo</div><div class="kpi-v">' +
       (R.diferencaMes > 0 ? '+' : '') + money(R.diferencaMes) + '</div>' +
       '<div class="kpi-s">cenário ' + R.ano + ' ante a carga atual · ' + pctTxt + '</div></div>';
  k += '<div class="' + clsKpi + '"><div class="kpi-l">Impacto anual no consumo</div><div class="kpi-v">' +
       (R.diferencaAno > 0 ? '+' : '') + money(R.diferencaAno) + '</div>' +
       '<div class="kpi-s">projeção de 12 meses</div></div>';
  if(reportMode === 'REPRESENTATIVE'){
    k += '<div class="kpi"><div class="kpi-l">Carga tributária em ' + R.ano + '</div><div class="kpi-v">' +
         money(C.reforma.tributaria.valor) + '</div><div class="kpi-s">' +
         (C.reforma.tributaria.pct == null ? 'não aplicável' : pctFmt(C.reforma.tributaria.pct) + ' do faturamento') +
         ' · hoje ' + money(C.atual.tributaria.valor) + '</div></div>';
    k += '<div class="kpi"><div class="kpi-l">Carga completa considerada</div><div class="kpi-v">' +
         money(R.completaReforma) + '</div><div class="kpi-s">por mês, incluindo IRPJ/CSLL e encargos históricos</div></div>';
  } else {
    k += '<div class="kpi"><div class="kpi-l">Carga completa considerada</div><div class="kpi-v">' +
         money(R.completaReforma) + '</div><div class="kpi-s">por mês, incluindo valores históricos</div></div>';
    k += '<div class="kpi"><div class="kpi-l">Crédito utilizável de IBS/CBS</div><div class="kpi-v">' +
         money(R.credito.total) + '</div><div class="kpi-s">' +
         (R.estorno.aplicavel
           ? 'bruto de ' + money(R.creditoBruto.total) + ' menos estorno de ' + money(R.estorno.estorno.total)
           : 'estimado sobre as compras creditáveis') + '</div></div>';
  }
  $('rp_kpis').innerHTML = k;
}

/* nota discreta quando o cliente ainda está no modelo anterior de detalhamento */
function notaModeloAnterior(P){
  if(P.currentRevenueMode !== 'DETAILED' || P.revenueModelUnified) return '';
  return '<div class="rep-nota-legado">Cliente salvo no modelo anterior de detalhamento. ' +
         'Os números refletem exatamente esse modelo; nada foi convertido para gerar este relatório.</div>';
}

/* =====================================================================
   A · RELATÓRIO REPRESENTATIVO
   ===================================================================== */
function montarCorpoRepresentativo(P, R, T, C){
  var h = '';
  h += notaModeloAnterior(P);

  /* carga sobre o faturamento + anualizados em forma visual */
  h += '<div class="rp-panel"><div class="rp-ph">Carga tributária sobre o faturamento</div>' +
       tabelaCarga(C) + repAnualizados(C) +
       '<div class="rp-foot" style="margin-top:12px">' +
       'O IBS é apresentado no grupo <b>“Estaduais e municipais”</b> por possuir competência compartilhada. ' +
       'O simulador não realiza rateio interno entre essas esferas. Os encargos trabalhistas/previdenciários ' +
       'aparecem separados da carga tributária e permanecem iguais nos dois cenários.' +
       '</div></div>';

  /* situação atual e cenário Reforma, lado a lado e resumidos */
  h += '<div class="rp-sec">Comparação do ano analisado</div>';
  h += '<div class="rp-grid2">';
  h += '<div class="rp-panel"><div class="rp-ph">Situação atual — média mensal</div>' + repTabelaAtual(R, P) + '</div>';
  h += '<div class="rp-panel"><div class="rp-ph">Cenário Reforma ' + R.ano + ' — média mensal</div>' + repTabelaReforma(R) + '</div>';
  h += '</div>';

  /* créditos em quadro resumido */
  h += '<div class="rp-panel"><div class="rp-ph">Créditos de IBS/CBS</div>' + repCreditos(R) + '</div>';

  /* operações, apenas quando existirem */
  var ops = repTabelaOperacoes(P);
  if(ops) h += '<div class="rp-sec">Operações informadas</div>' + ops;
  var trat = repResumoTratamentos(R);
  if(trat) h += '<div class="rp-panel"><div class="rp-ph">Receita por tratamento na Reforma</div>' + trat + '</div>';

  /* trajetória com o ano do relatório destacado */
  h += '<div class="rp-sec">O ano analisado dentro da transição</div>';
  h += '<div class="rp-panel"><div class="rp-ph">Evolução estimada da carga — 2027 a 2033</div>' +
       repTrajetoria(T, P, R) +
       '<div id="rp_graficoRep" style="margin-top:16px"></div>' +
       legendaGrafico() + '</div>';

  /* síntese objetiva, sem recomendação */
  h += '<div class="rp-panel"><div class="rp-ph">Síntese da simulação</div>' +
       '<div class="rep-sintese">' + repSintese(R, C, P) + '</div></div>';

  /* premissas principais, em quadro curto */
  h += '<div class="rp-panel"><div class="rp-ph">Premissas principais</div>' + repPremissasPrincipais(P, R) + '</div>';

  $('rp_rep').innerHTML = h;
  // gráfico estático, montado depois de o container existir
  $('rp_graficoRep').innerHTML = graficoLinha(T, R.ano);
}

/** anualização apresentada visualmente — a conta mensal × 12 fica no técnico */
function repAnualizados(C){
  function bloco(t, a, b){
    return '<div class="rep-anual-b"><div class="rep-anual-h">' + t + '</div>' +
      '<div class="rep-anual-l"><span>Atual</span><b>' + money(a) + '</b></div>' +
      '<div class="rep-anual-l"><span>Reforma ' + C.ano + '</span><b>' + money(b) + '</b></div></div>';
  }
  return '<div class="rep-anual">' +
    bloco('Carga tributária anualizada', C.atual.tributaria.valor * 12, C.reforma.tributaria.valor * 12) +
    bloco('Carga completa anualizada', C.atual.completa.valor * 12, C.reforma.completa.valor * 12) + '</div>';
}

function repTabelaAtual(R, P){
  var h = '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Tributo</th><th>Média mensal</th></tr></thead><tbody>';
  componentesPisCofins(R, P).forEach(function(c){
    h += '<tr><td>' + esc(c.rotulo) + '</td><td>' + money(c.valor) + '</td></tr>';
  });
  componentesLegados(R, P, true).forEach(function(c){
    h += '<tr><td>' + esc(c.rotulo) + '</td><td>' + money(c.valor) + '</td></tr>';
  });
  h += '</tbody><tfoot><tr><td>Total</td><td>' + money(R.atual.total) + '</td></tr></tfoot></table></div>';
  return h;
}

function repTabelaReforma(R){
  var h = '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Tributo</th><th>Média mensal</th></tr></thead><tbody>';
  h += '<tr><td>IBS a recolher</td><td>' + money(R.liquido.ibs) + '</td></tr>';
  h += '<tr><td>CBS a recolher</td><td>' + money(R.liquido.cbs) + '</td></tr>';
  h += '<tr><td>ICMS remanescente (' + pctFmt(R.legado.fatorIcms, 0) + ')</td><td>' + money(R.legado.icms) + '</td></tr>';
  h += '<tr><td>ISS remanescente (' + pctFmt(R.legado.fatorIss, 0) + ')</td><td>' + money(R.legado.iss) + '</td></tr>';
  h += '<tr><td>IPI residual / ZFM</td><td>' + money(R.legado.ipi) + '</td></tr>';
  h += '<tr><td>Imposto Seletivo</td><td>' + money(R.seletivo.valor) + '</td></tr>';
  h += '<tr><td>PIS/Cofins</td><td>extintos</td></tr>';
  h += '</tbody><tfoot><tr><td>Total projetado</td><td>' + money(R.consumoReforma) + '</td></tr></tfoot></table></div>';
  if(R.liquido.saldoCredorTotal > 0){
    h += '<div class="rp-foot" style="margin-top:10px"><b>Saldo credor estimado:</b> ' +
         money(R.liquido.saldoCredorTotal) + ' por mês (IBS ' + money(R.liquido.saldoCredorIbs) +
         ' · CBS ' + money(R.liquido.saldoCredorCbs) + '). É saldo credor, não redução dos demais tributos: ' +
         'o simulador não compensa esse valor com ICMS, ISS, IPI ou IRPJ/CSLL.</div>';
  }
  return h;
}

function repCreditos(R){
  var h = '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Item</th><th>IBS</th><th>CBS</th><th>Total</th></tr></thead><tbody>';
  function l(rot, a, b, c){ return '<tr><td>' + rot + '</td><td>' + money(a) + '</td><td>' + money(b) + '</td><td>' + money(c) + '</td></tr>'; }
  h += l('Crédito potencial bruto', R.creditoBruto.ibs, R.creditoBruto.cbs, R.creditoBruto.total);
  if(R.estorno.aplicavel){
    h += l('(−) Estorno estimado (' + pctFmt(R.estorno.percentualEstorno) + ')',
           R.estorno.estorno.ibs, R.estorno.estorno.cbs, R.estorno.estorno.total);
  }
  h += '</tbody><tfoot>';
  h += l('Crédito utilizável', R.credito.ibs, R.credito.cbs, R.credito.total);
  if(R.liquido.saldoCredorTotal > 0){
    h += l('Saldo credor estimado', R.liquido.saldoCredorIbs, R.liquido.saldoCredorCbs, R.liquido.saldoCredorTotal);
  }
  h += '</tfoot></table></div>';
  h += '<div class="rp-foot" style="margin-top:10px">' +
       (R.estorno.aplicavel
         ? 'Parte da receita do período é isenta ou imune e exige anulação proporcional dos créditos das aquisições. Exportações não entram nessa proporção.'
         : 'Nenhuma receita do período exige anulação proporcional de créditos.') +
       ' O crédito de IBS abate apenas IBS e o de CBS apenas CBS.</div>';
  return h;
}

/** tabela executiva das operações — sem abrir os tributos por linha */
function repTabelaOperacoes(P){
  var d = P.atualDetalhado;
  if(!d || !d.linhas || !d.linhas.length) return '';           // SIMPLE não mostra tabela vazia
  var uni = !!P.revenueModelUnified;
  var h = '<div class="rp-panel"><div class="rp-ph">Composição do faturamento — ' +
          d.linhas.length + (d.linhas.length === 1 ? ' operação' : ' operações') + '</div>';
  h += '<div class="table-scroll"><table class="rp-tab"><thead><tr>' +
       '<th>Operação</th><th>Natureza</th><th>Faturamento</th><th>Tributos atuais</th><th>Carga efetiva</th>' +
       (uni ? '<th>Tratamento Reforma</th>' : '') + '</tr></thead><tbody>';
  d.linhas.forEach(function(l){
    h += '<tr><td>' + esc(l.descricao) + '</td>' +
         '<td style="text-align:left">' + esc(l.naturezaRotulo) + '</td>' +
         '<td>' + money(l.faturamento) + '</td>' +
         '<td>' + money(l.tributos) + '</td>' +
         '<td>' + (l.cargaEfetiva == null ? '—' : pctFmt(l.cargaEfetiva)) + '</td>' +
         (uni ? '<td style="text-align:left">' + esc(l.tratamentoRotulo) +
                (l.pctCustom != null ? ' (' + pctFmt(l.pctCustom, 0) + ')' : '') + '</td>' : '') +
         '</tr>';
  });
  h += '</tbody><tfoot><tr><td>Totais</td><td></td><td>' + money(d.faturamentoDetalhado) + '</td><td>' +
       money(d.totalTributos) + '</td><td></td>' + (uni ? '<td></td>' : '') + '</tr></tfoot></table></div>';
  h += '<div class="rp-foot" style="margin-top:10px"><b>Carga efetiva</b> é a relação entre os tributos informados e a ' +
       'receita da própria operação — não é alíquota fiscal. A abertura por tributo está no relatório com cálculos.</div>';
  return h + '</div>';
}

/** soma da receita por tratamento — apenas os que têm valor */
function repResumoTratamentos(R){
  var por = {};
  R.tratamento.linhas.forEach(function(l){
    if(!(l.valor > 0)) return;
    var t = null;
    FISCAL_RULES.tratamentosReceita.forEach(function(x){ if(x.id === l.tratamento) t = x; });
    var rot = t ? t.rotulo : l.tratamento;
    por[rot] = (por[rot] || 0) + l.valor;
  });
  var chaves = Object.keys(por);
  if(!chaves.length) return '';
  var h = '<div class="rep-trat">';
  FISCAL_RULES.tratamentosReceita.forEach(function(x){
    if(por[x.rotulo] != null) h += '<span>' + esc(x.rotulo) + ': <b>' + money(por[x.rotulo]) + '</b></span>';
  });
  chaves.forEach(function(k){
    var conhecido = false;
    FISCAL_RULES.tratamentosReceita.forEach(function(x){ if(x.rotulo === k) conhecido = true; });
    if(!conhecido) h += '<span>' + esc(k) + ': <b>' + money(por[k]) + '</b></span>';
  });
  h += '</div><div class="rp-foot" style="margin-top:10px">Soma da receita por tratamento informado. ' +
       'Apenas os tratamentos com valor aparecem.</div>';
  return h;
}

/** trajetória resumida com o ano do relatório destacado */
function repTrajetoria(T, P, R){
  var h = '<div class="table-scroll"><table class="rp-tab"><thead><tr>' +
    '<th>Ano</th><th>Consumo Reforma</th><th>Carga tributária</th><th>% do faturamento</th></tr></thead><tbody>';
  T.forEach(function(y){
    var c = calculateTaxBurdenBreakdown(y, P).reforma.tributaria;
    // meta.anos guarda numeros e R.ano vem do seletor como texto: comparar como texto
    var atual = (String(y.ano) === String(R.ano));
    h += '<tr' + (atual ? ' class="ano-foco"' : '') + '><td>' + y.ano + (atual ? ' · ano analisado' : '') + '</td>' +
         '<td>' + money(y.consumoReforma) + '</td>' +
         '<td>' + money(c.valor) + '</td>' +
         '<td>' + (c.pct == null ? 'não aplicável' : pctFmt(c.pct)) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function legendaGrafico(){
  return '<div class="rp-leg">' +
    '<span><i style="background:#1a1a1a"></i>Carga atual de consumo (referência)</span>' +
    '<span><i style="background:#5c0a0a"></i>Consumo no cenário Reforma</span>' +
    '<span><i style="background:#21867a"></i>Carga completa considerada</span></div>';
}

/** síntese objetiva: só descreve o que já foi calculado. Sem recomendação. */
function repSintese(R, C, P){
  var h = '';
  var verbo = R.diferencaMes > 0.005 ? 'aumenta' : (R.diferencaMes < -0.005 ? 'reduz' : 'permanece próxima');
  var pctTxt = (R.diferencaPct == null) ? 'não aplicável'
             : ((R.diferencaPct > 0 ? '+' : '') + pctFmt(R.diferencaPct, 1));
  h += '<p>No cenário de <b>' + R.ano + '</b>, a carga mensal sobre consumo <b>' + verbo + '</b>: passa de <b>' +
       money(R.consumoAtual) + '</b> para <b>' + money(R.consumoReforma) + '</b>, variação de <b>' +
       (R.diferencaMes > 0 ? '+' : '') + money(R.diferencaMes) + '</b> (' + pctTxt + '), equivalente a <b>' +
       (R.diferencaAno > 0 ? '+' : '') + money(R.diferencaAno) + '</b> em doze meses.</p>';
  h += '<p>Sobre o faturamento, a carga tributária sai de <b>' +
       (C.atual.tributaria.pct == null ? 'não aplicável' : pctFmt(C.atual.tributaria.pct)) + '</b> para <b>' +
       (C.reforma.tributaria.pct == null ? 'não aplicável' : pctFmt(C.reforma.tributaria.pct)) +
       '</b>. Os encargos trabalhistas/previdenciários somam <b>' + money(C.atual.encargos.valor) +
       '</b> e permanecem iguais nos dois cenários, por serem médias históricas informadas.</p>';
  // IRPJ e CSLL aparecem nomeados um a um, nunca somados num rótulo único
  h += '<p>' + componentesIrpjCsll(P, R).map(function(x){
         return esc(x.rotulo) + ' de <b>' + money(x.mensal) + '</b> por mês';
       }).join(' e ') + ' completam a comparação de carga. São médias históricas informadas ' +
       'e não são recalculadas pela Reforma nem por esta ferramenta.</p>';
  h += '<p>O ano analisado faz parte da transição de 2027 a 2033: as alíquotas de IBS e CBS e os percentuais ' +
       'remanescentes de ICMS e ISS mudam a cada ano, conforme a tabela e o gráfico acima.</p>';
  h += '<p>Esta é uma <b>simulação consultiva</b> construída sobre os dados e as premissas informados. ' +
       'Não constitui recomendação de conduta tributária nem substitui a apuração da empresa.</p>';
  return h;
}

/** quadro curto de premissas — a tabela completa fica no relatório técnico */
function repPremissasPrincipais(P, R){
  var r = regrasDoAno(FISCAL_RULES, R.ano);
  var itens = [
    ['Ano analisado', R.ano, 'USER_INPUT'],
    ['IBS', pctFmt(r.ibs.valor), r.ibs.status],
    ['CBS', pctFmt(r.cbs.valor), r.cbs.status],
    ['ICMS remanescente', pctFmt(r.icmsRemanescente.valor, 0), r.icmsRemanescente.status],
    ['ISS remanescente', pctFmt(r.issRemanescente.valor, 0), r.issRemanescente.status]
  ];
  if(P.reducaoGeral > 0) itens.push(['Redução geral de alíquota', pctFmt(P.reducaoGeral, 0), 'USER_CUSTOM']);
  if(P.impostoSeletivo && P.impostoSeletivo.sujeita) itens.push(['Imposto Seletivo', money(R.seletivo.valor), R.seletivo.status || 'USER_INPUT']);
  if(P.revenueModelUnified) itens.push(['Detalhamento de receitas', 'Unificado por operação', 'USER_INPUT']);

  var h = '<div class="rep-prem">';
  itens.forEach(function(i){
    h += '<div class="rep-prem-i"><div class="rep-prem-r">' + esc(i[0]) + '</div>' +
         '<div class="rep-prem-v">' + i[1] + '</div>' +
         '<div class="rep-prem-s">' + tagStatus(i[2]) + '</div></div>';
  });
  h += '</div>';
  /* Só entra quando é pertinente, isto é, quando o ano do relatório é um dos
     dois com CBS reduzida. Vai no rodapé que já existe, sem painel novo: o
     Representativo é executivo e não comporta um parágrafo extra por premissa. */
  var expCbs = explicacaoCbs(R.ano);
  h += '<div class="rp-foot" style="margin-top:12px">' +
       (expCbs ? '<b>Sobre a CBS de ' + R.ano + '.</b> ' + esc(expCbs) + ' ' : '') +
       'Valores marcados como <b>Estimativa atual</b>, <b>Projeção</b> ' +
       'ou <b>Personalizado</b> não são alíquotas legalmente definitivas. A tabela completa de premissas, com a fonte ' +
       'registrada de cada número, está no relatório com cálculos.</div>';
  return h;
}

/* =====================================================================
   C · RELATÓRIO COMPLETO DA TRANSIÇÃO 2027–2033
   ---------------------------------------------------------------------
   Documento próprio, não é a repetição dos outros dois. Estrutura:
     PARTE 1  capa, panorama comparativo, alíquotas, gráfico e a composição
              estrutural da empresa — apresentada UMA única vez;
     PARTE 2  uma ficha por ano da transição, cada uma em folha própria e
              autossuficiente (identificação + números do ano);
     PARTE 3  premissas da trajetória, metodologia, fontes e disclaimer.

   Toda a aritmética vem de T (trajetória já calculada pelo motor) e dos
   helpers existentes. Nenhum ano é recalculado por uma segunda fórmula, e
   gerar o documento não altera o ano selecionado nem qualquer dado salvo.
   ===================================================================== */
function montarCorpoCompleto(P, R, T, C){
  var anos = T.map(function(y){ return y.ano; });
  var h = '';

  h += ftCapa(P, R, T, C);
  h += ftPanorama(P, T);
  h += ftAliquotas(T);
  h += '<div class="rp-panel"><div class="rp-ph">Evolução estimada da carga — ' +
       anos[0] + ' a ' + anos[anos.length-1] + '</div>' +
       '<div id="rp_graficoFull"></div>' + legendaGrafico() +
       '<div class="rp-foot" style="margin-top:10px">A linha da situação atual permanece como referência, ' +
       'enquanto o cenário Reforma varia conforme as alíquotas de IBS/CBS e a redução progressiva de ICMS e ISS ' +
       'consideradas em cada ano deste conjunto de premissas.</div></div>';
  h += ftComposicao(P, R);
  h += ftEstrutural(P, R);

  /* PARTE 2 — uma ficha por ano */
  T.forEach(function(y){
    h += ftAno(P, y);
  });

  /* PARTE 3 — encerramento */
  h += ftPremissasTransicao(T);
  h += ftMetodologia(P);

  $('rp_full').innerHTML = h;
  // gráfico estático: sem tooltip e sem áreas sensíveis
  $('rp_graficoFull').innerHTML = graficoLinha(T, null, false);
}

/* ---------------- PARTE 1 ---------------- */

function ftCapa(P, R, T, C){
  var anos = T.map(function(y){ return y.ano; });
  var primeiro = T[0], ultimo = T[T.length-1];
  var cUlt = calculateTaxBurdenBreakdown(ultimo, P);
  var h = '<div class="ft-capa">';
  h += '<div class="ft-capa-t">Relatório completo da transição ' + anos[0] + '–' + anos[anos.length-1] + '</div>';
  h += '<div class="ft-capa-s">Impacto da Reforma Tributária — Lucro Real</div>';
  h += '<div class="ft-capa-p">Evolução estimada da carga entre ' + anos[0] +
       ' e ' + anos[anos.length-1] + ', com cada ano da transição em detalhe.</div>';
  h += '<div class="ft-destaques">';
  function d(rot, val, sub){
    return '<div class="ft-d"><div class="ft-d-l">' + rot + '</div><div class="ft-d-v">' + val + '</div>' +
           (sub ? '<div class="ft-d-s">' + sub + '</div>' : '') + '</div>';
  }
  h += d('Carga atual sobre consumo', money(R.consumoAtual), 'por mês, informada por você');
  h += d('Reforma em ' + primeiro.ano, money(primeiro.consumoReforma), 'primeiro ano da transição');
  h += d('Reforma em ' + ultimo.ano, money(ultimo.consumoReforma), 'regime pleno considerado');
  h += d('Carga tributária hoje', (C.atual.tributaria.pct == null ? 'não aplicável' : pctFmt(C.atual.tributaria.pct)),
         'sobre o faturamento');
  h += d('Carga tributária em ' + ultimo.ano, (cUlt.reforma.tributaria.pct == null ? 'não aplicável' : pctFmt(cUlt.reforma.tributaria.pct)),
         'sobre o faturamento');
  h += '</div>';
  h += '<div class="ft-capa-n">Ano atualmente selecionado na simulação: <b>' + R.ano + '</b>. ' +
       'Este documento apresenta todos os anos da trajetória, independentemente dessa seleção.</div>';
  h += '</div>';
  return h;
}

/** panorama comparativo — uma linha por ano, direto de T */
function ftPanorama(P, T){
  var h = '<div class="rp-sec">Panorama da transição</div>';
  h += '<div class="rp-panel"><div class="rp-ph">Comparação dos anos da transição</div>';
  h += '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Ano</th>' +
       '<th>Consumo Reforma</th><th>Impacto mensal</th><th>Carga tributária</th>' +
       '<th>% do faturamento</th><th>Carga completa</th></tr></thead><tbody>';
  T.forEach(function(y){
    var c = calculateTaxBurdenBreakdown(y, P).reforma.tributaria;
    var d = y.diferencaMes;
    h += '<tr><td>' + y.ano + '</td>' +
         '<td>' + money(y.consumoReforma) + '</td>' +
         '<td class="' + (d > 0.005 ? 'up' : (d < -0.005 ? 'down' : '')) + '">' + (d > 0 ? '+' : '') + money(d) + '</td>' +
         '<td>' + money(c.valor) + '</td>' +
         '<td>' + (c.pct == null ? 'não aplicável' : pctFmt(c.pct)) + '</td>' +
         '<td>' + money(y.completaReforma) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  var ref = T[0];
  h += '<div class="rp-foot" style="margin-top:10px"><b>Situação atual de referência:</b> consumo ' +
       money(ref.consumoAtual) + ' · carga tributária ' + money(calculateTaxBurdenBreakdown(ref, P).atual.tributaria.valor) +
       ' · carga completa ' + money(ref.completaAtual) + ' por mês. Esses valores são os mesmos em toda a trajetória, ' +
       'por virem dos dados informados para a situação atual.</div>';
  return h + '</div>';
}

/** alíquotas e transição, ano a ano */
function ftAliquotas(T){
  var h = '<div class="rp-panel"><div class="rp-ph">Alíquotas e transição consideradas em cada ano</div>';
  h += '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Ano</th><th>IBS</th><th>CBS</th>' +
       '<th>ICMS remanescente</th><th>ISS remanescente</th></tr></thead><tbody>';
  T.forEach(function(y){
    var r = regrasDoAno(FISCAL_RULES, y.ano);
    h += '<tr><td>' + y.ano + '</td>' +
         '<td>' + pctFmt(r.ibs.valor) + '</td>' +
         '<td>' + pctFmt(r.cbs.valor) + '</td>' +
         '<td>' + pctFmt(r.icmsRemanescente.valor, 0) + '</td>' +
         '<td>' + pctFmt(r.issRemanescente.valor, 0) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  /* A pergunta "por que 2027 e 2028 têm CBS diferente dos demais anos?" nasce
     olhando exatamente esta tabela. A nota entra no rodapé que já existe, uma
     única vez no documento: um bloco novo empurrava a paginação estrutural e
     deixava a folha seguinte quase vazia. */
  var expCbs = explicacaoCbs('2027');
  h += '<div class="rp-foot" style="margin-top:10px">' +
       (expCbs ? '<b>Sobre a CBS de 2027 e 2028.</b> ' + esc(expCbs) + ' ' : '') +
       'A origem e o status de cada percentual estão na seção ' +
       '<b>Premissas da transição</b>, ao final deste documento. As fontes registradas aparecem uma única vez, no encerramento.</div>';
  return h + '</div>';
}

/** composição econômica da empresa — apresentada uma única vez */
function ftComposicao(P, R){
  var h = '<div class="rp-sec">Composição da empresa considerada</div>';
  h += notaModeloAnterior(P);
  var d = P.atualDetalhado;

  if(d && d.linhas && d.linhas.length){
    var uni = !!P.revenueModelUnified;
    h += '<div class="rp-panel"><div class="rp-ph">Composição do faturamento — ' + d.linhas.length +
         (d.linhas.length === 1 ? ' operação' : ' operações') + '</div>';
    h += '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Operação</th><th>Natureza</th>' +
         '<th>Faturamento</th><th>Tributos atuais</th><th>Carga efetiva</th>' +
         (uni ? '<th>Tratamento Reforma</th>' : '') + '</tr></thead><tbody>';
    d.linhas.forEach(function(l){
      h += '<tr><td>' + esc(l.descricao) + '</td>' +
           '<td style="text-align:left">' + esc(l.naturezaRotulo) + '</td>' +
           '<td>' + money(l.faturamento) + '</td>' +
           '<td>' + money(l.tributos) + '</td>' +
           '<td>' + (l.cargaEfetiva == null ? '—' : pctFmt(l.cargaEfetiva)) + '</td>' +
           (uni ? '<td style="text-align:left">' + esc(l.tratamentoRotulo) +
                  (l.pctCustom != null ? ' (' + pctFmt(l.pctCustom, 0) + ')' : '') + '</td>' : '') + '</tr>';
    });
    h += '</tbody><tfoot><tr><td>Totais</td><td></td><td>' + money(d.faturamentoDetalhado) + '</td><td>' +
         money(d.totalTributos) + '</td><td></td>' + (uni ? '<td></td>' : '') + '</tr></tfoot></table></div>';
    h += '<div class="rp-foot" style="margin-top:10px">Esta composição é a mesma em todos os anos da transição. ' +
         'O que muda a cada ano são as alíquotas, os fatores da transição e, por consequência, débitos, créditos e totais. ' +
         'Por isso ela aparece uma única vez, e não repetida em cada seção anual.</div>';
    h += '</div>';
  } else {
    h += '<div class="rp-panel"><div class="rp-ph">Dados informados</div><div class="ft-grid">';
    h += '<div class="ft-bloco"><div class="ft-bt">Operação</div>' +
      '<div class="ft-l"><span>Faturamento médio mensal</span><b>' + money(P.faturamento) + '</b></div>' +
      '<div class="ft-l"><span>Compras médias mensais</span><b>' + money(P.compras) + '</b></div>' +
      '<div class="ft-l"><span>Exportações</span><b>' + pctFmt(P.pctExportacao, 0) + ' do faturamento</b></div>' +
      '</div>';
    h += '<div class="ft-bloco"><div class="ft-bt">Situação atual — média mensal</div>' +
      componentesPisCofins(R, P).map(function(x){
        return '<div class="ft-l"><span>' + esc(x.rotulo) + '</span><b>' + money(x.valor) + '</b></div>';
      }).join('') +
      componentesLegados(R, P, true).map(function(x){
        return '<div class="ft-l"><span>' + esc(x.rotulo) + '</span><b>' + money(x.valor) + '</b></div>';
      }).join('') +
      '<div class="ft-l tot"><span>Total</span><b>' + money(R.atual.total) + '</b></div>' +
      '</div>';
    h += '</div>';
    h += '<div class="rp-foot" style="margin-top:10px">Simulação no <b>modo simples</b>: o faturamento não foi ' +
         'detalhado por operação. Esta composição é a mesma em todos os anos da transição.</div>';
    h += '</div>';
  }

  var trat = ftResumoTratamentos(R, true);
  if(trat) h += '<div class="rp-panel"><div class="rp-ph">Receita por tratamento na Reforma</div>' + trat +
    '<div class="rp-foot" style="margin-top:10px">Os tratamentos escolhidos valem para toda a trajetória. ' +
    'O que muda por ano é a alíquota aplicada a cada um deles.</div></div>';
  return h;
}

/** compras, IRPJ/CSLL e encargos — visão estrutural, uma vez só */
function ftEstrutural(P, R){
  // folha estrutural B: o que a empresa compra e os valores históricos do período
  var h = '<div class="rp-panel ft-quebra"><div class="rp-ph">Créditos das compras — estrutura considerada</div>';
  if(R.modoCompras === 'DETAILED' && R.comprasDetalhe && R.comprasDetalhe.linhas){
    h += '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Grupo de aquisição</th><th>Tipo</th>' +
         '<th>Valor/base</th><th>Fator ou alíquota informada</th></tr></thead><tbody>';
    R.comprasDetalhe.linhas.forEach(function(g){
      h += '<tr><td>' + esc(g.descricao || '(sem descrição)') + '</td>' +
           '<td style="text-align:left">' + esc(g.tipoRotulo || g.tipo) + '</td>' +
           '<td>' + money(g.valor) + '</td>' +
           '<td style="text-align:left">' + esc(g.detalheFator || '—') + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td>Compras classificadas</td><td></td><td>' +
         money(R.creditoBruto.comprasClassificadas != null ? R.creditoBruto.comprasClassificadas : R.creditoBruto.compras) +
         '</td><td></td></tr></tfoot></table></div>';
    h += '<div class="rp-foot" style="margin-top:10px">Modo de créditos: <b>detalhado por grupo de aquisição</b>. ' +
         'Os valores de crédito em reais mudam a cada ano, conforme a alíquota do ano, e aparecem na seção de cada ano.</div>';
  } else {
    h += '<div class="ft-grid"><div class="ft-bloco"><div class="ft-bt">Modo simplificado</div>' +
      '<div class="ft-l"><span>Compras médias mensais</span><b>' + money(R.creditoBruto.compras) + '</b></div>' +
      '<div class="ft-l"><span>Percentual creditável informado</span><b>' + pctFmt(R.creditoBruto.pct, 0) + '</b></div>' +
      '<div class="ft-l"><span>Base estimada de crédito</span><b>' + money(R.creditoBruto.base) + '</b></div>' +
      '</div><div class="ft-bloco"><div class="ft-bt">Como é usada</div>' +
      '<div class="ft-nota">A base estimada é a mesma em todos os anos. O crédito em reais muda conforme a alíquota ' +
      'de IBS e CBS de cada ano e aparece na seção anual correspondente.</div></div></div>';
  }
  h += '</div>';

  /* IRPJ/CSLL e encargos: explicados uma única vez */
  var c = R.complementar, ent = P.irpjEntrada || { periodicidade:'MENSAL', informado:c.irpjCsll };
  h += '<div class="rp-panel"><div class="rp-ph">Valores históricos considerados em todos os anos</div><div class="ft-grid">';
  h += '<div class="ft-bloco"><div class="ft-bt">IRPJ e CSLL</div>';
  componentesIrpjCsll(P, R).forEach(function(x){
    if(x.periodicidade === 'TRIMESTRAL'){
      h += '<div class="ft-l"><span>' + esc(x.rotulo) + ' — trimestral informado</span><b>' + money(x.informado) + '</b></div>';
      h += '<div class="ft-l"><span>' + esc(x.rotulo) + ' — mensal (÷ 3)</span><b>' + money(x.mensal) + '</b></div>';
    } else {
      h += '<div class="ft-l"><span>' + esc(x.rotulo) + ' — mensal informado</span><b>' + money(x.mensal) + '</b></div>';
    }
  });
  h += '<div class="ft-l tot"><span>Total mensal utilizado</span><b>' + money(c.irpjCsll) + '</b></div>';
  h += '<div class="ft-nota">Médias históricas informadas. Não são recalculadas pela Reforma nem por esta ferramenta.</div></div>';
  h += '<div class="ft-bloco"><div class="ft-bt">Encargos trabalhistas/previdenciários</div>' +
    '<div class="ft-l"><span>Encargos patronais</span><b>' + money(c.encargosPatronais) + '</b></div>' +
    '<div class="ft-l"><span>Encargos de pró-labore</span><b>' + money(c.encargosProLabore) + '</b></div>' +
    '<div class="ft-l tot"><span>Total</span><b>' + money(c.encargosPatronais + c.encargosProLabore) + '</b></div>' +
    '<div class="ft-nota">Médias históricas informadas, constantes em toda a trajetória. Não são tributos e por isso ' +
    'aparecem separadas da carga tributária.</div></div>';
  h += '</div></div>';
  return h;
}

/** soma da receita por tratamento — só os que têm valor */
function ftResumoTratamentos(R, comNota){
  var por = {};
  R.tratamento.linhas.forEach(function(l){
    if(!(l.valor > 0)) return;
    var t = null;
    FISCAL_RULES.tratamentosReceita.forEach(function(x){ if(x.id === l.tratamento) t = x; });
    var rot = t ? t.rotulo : l.tratamento;
    por[rot] = (por[rot] || 0) + l.valor;
  });
  if(!Object.keys(por).length) return '';
  var h = '<div class="ft-trat">';
  FISCAL_RULES.tratamentosReceita.forEach(function(x){
    if(por[x.rotulo] != null) h += '<span>' + esc(x.rotulo) + ': <b>' + money(por[x.rotulo]) + '</b></span>';
  });
  Object.keys(por).forEach(function(k){
    var conhecido = false;
    FISCAL_RULES.tratamentosReceita.forEach(function(x){ if(x.rotulo === k) conhecido = true; });
    if(!conhecido) h += '<span>' + esc(k) + ': <b>' + money(por[k]) + '</b></span>';
  });
  return h + '</div>';
}

/* ---------------- PARTE 2 · ficha de cada ano ---------------- */

/** cabeçalho compacto que reabre a identidade em cada ano */
function ftCabecalhoAno(P, ano){
  var seg = null;
  FISCAL_RULES.segmentos.forEach(function(x){ if(x.id === P.segmento) seg = x; });
  var h = '<div class="ft-cab"><div class="ft-cab-txt">';
  h += '<div class="ft-cab-esc">' + esc(escTexto('nome') || 'Contabiliza') + '</div>';
  h += '<div class="ft-cab-cli">Cliente: <b>' + esc(P.empresa || 'Não informado') + '</b>' +
       ' · CNPJ: ' + esc(P.cnpj || 'não informado') +
       ' · Segmento principal: ' + esc(seg ? seg.rotulo : '—') + '</div>';
  h += '</div>';
  // sem logo configurada, o quadro simplesmente não é criado
  if(escritorio.logo){
    h += '<div class="ft-cab-logo"><img alt="Logomarca" src="' + escritorio.logo + '"></div>';
  }
  h += '</div>';
  return h;
}

/** ficha anual autossuficiente. Recebe o R daquele ano, vindo de T. */
function ftAno(P, y){
  var c = calculateTaxBurdenBreakdown(y, P);
  var r = regrasDoAno(FISCAL_RULES, y.ano);
  var h = '<div class="ft-ano">';
  h += ftCabecalhoAno(P, y.ano);
  h += '<div class="ft-faixa"><span class="ft-faixa-l">Ano da transição</span>' +
       '<span class="ft-faixa-a">' + y.ano + '</span>' +
       '<span class="ft-faixa-f">IBS ' + pctFmt(r.ibs.valor) + ' · CBS ' + pctFmt(r.cbs.valor) +
       ' · ICMS remanescente ' + pctFmt(r.icmsRemanescente.valor, 0) +
       ' · ISS remanescente ' + pctFmt(r.issRemanescente.valor, 0) + '</span></div>';
  h += '<div class="ft-frase">' + fraseExecutivaAno(y) + '</div>';

  h += '<div class="ft-grid">';

  /* resumo do ano */
  h += '<div class="ft-bloco"><div class="ft-bt">Resumo de ' + y.ano + '</div>' +
    '<div class="ft-l"><span>Carga atual sobre consumo</span><b>' + money(y.consumoAtual) + '</b></div>' +
    '<div class="ft-l"><span>Carga no cenário Reforma</span><b>' + money(y.consumoReforma) + '</b></div>' +
    '<div class="ft-l"><span>Impacto mensal</span><b>' + (y.diferencaMes > 0 ? '+' : '') + money(y.diferencaMes) + '</b></div>' +
    '<div class="ft-l"><span>Impacto anual</span><b>' + (y.diferencaAno > 0 ? '+' : '') + money(y.diferencaAno) + '</b></div>' +
    '<div class="ft-l tot"><span>Carga completa considerada</span><b>' + money(y.completaReforma) + '</b></div>' +
    '</div>';

  /* carga sobre o faturamento */
  function lc(rot, b){
    return '<div class="ft-l"><span>' + rot + '</span><b>' + money(b.valor) +
      '<span class="pct">' + (b.pct == null ? 'não aplicável' : pctFmt(b.pct)) + '</span></b></div>';
  }
  h += '<div class="ft-bloco"><div class="ft-bt">Carga sobre o faturamento em ' + y.ano + '</div>' +
    lc('Federais', c.reforma.federais) +
    lc('Estaduais e municipais', c.reforma.estaduaisMunicipais) +
    '<div class="ft-l tot"><span>Carga tributária</span><b>' + money(c.reforma.tributaria.valor) +
      '<span class="pct">' + (c.reforma.tributaria.pct == null ? 'não aplicável' : pctFmt(c.reforma.tributaria.pct)) + '</span></b></div>' +
    lc('Encargos trabalhistas/previdenciários', c.reforma.encargos) +
    '<div class="ft-l tot"><span>Carga completa considerada</span><b>' + money(c.reforma.completa.valor) +
      '<span class="pct">' + (c.reforma.completa.pct == null ? 'não aplicável' : pctFmt(c.reforma.completa.pct)) + '</span></b></div>' +
    '</div>';

  /* formação do cenário */
  h += '<div class="ft-bloco"><div class="ft-bt">Formação do cenário Reforma</div>' +
    '<div class="ft-l"><span>IBS — débito</span><b>' + money(y.debito.ibs) + '</b></div>' +
    '<div class="ft-l"><span>CBS — débito</span><b>' + money(y.debito.cbs) + '</b></div>' +
    '<div class="ft-l"><span>(−) Crédito utilizável de IBS/CBS</span><b>−' + money(y.credito.total) + '</b></div>' +
    '<div class="ft-l"><span>ICMS remanescente (' + pctFmt(y.legado.fatorIcms, 0) + ')</span><b>' + money(y.legado.icms) + '</b></div>' +
    '<div class="ft-l"><span>ISS remanescente (' + pctFmt(y.legado.fatorIss, 0) + ')</span><b>' + money(y.legado.iss) + '</b></div>' +
    '<div class="ft-l"><span>IPI residual / ZFM</span><b>' + money(y.legado.ipi) + '</b></div>' +
    '<div class="ft-l"><span>Imposto Seletivo</span><b>' + money(y.seletivo.valor) + '</b></div>' +
    '<div class="ft-l"><span>PIS/Cofins</span><b>extintos</b></div>' +
    '<div class="ft-l tot"><span>Total projetado</span><b>' + money(y.consumoReforma) + '</b></div>' +
    '</div>';

  /* créditos do ano */
  h += '<div class="ft-bloco"><div class="ft-bt">Créditos de IBS/CBS em ' + y.ano + '</div>' +
    '<div class="ft-l"><span>Crédito bruto — IBS</span><b>' + money(y.creditoBruto.ibs) + '</b></div>' +
    '<div class="ft-l"><span>Crédito bruto — CBS</span><b>' + money(y.creditoBruto.cbs) + '</b></div>' +
    (y.estorno.aplicavel
      ? '<div class="ft-l"><span>Estorno — IBS (' + pctFmt(y.estorno.percentualEstorno) + ')</span><b>−' + money(y.estorno.estorno.ibs) + '</b></div>' +
        '<div class="ft-l"><span>Estorno — CBS (' + pctFmt(y.estorno.percentualEstorno) + ')</span><b>−' + money(y.estorno.estorno.cbs) + '</b></div>'
      : '') +
    '<div class="ft-l"><span>Crédito utilizável — IBS</span><b>' + money(y.credito.ibs) + '</b></div>' +
    '<div class="ft-l"><span>Crédito utilizável — CBS</span><b>' + money(y.credito.cbs) + '</b></div>' +
    '<div class="ft-l tot"><span>Crédito utilizável total</span><b>' + money(y.credito.total) + '</b></div>' +
    '</div>';

  h += '</div>';

  if(y.liquido.saldoCredorTotal > 0){
    h += '<div class="ft-saldo"><b>Saldo credor estimado em ' + y.ano + ': ' + money(y.liquido.saldoCredorTotal) +
      ' por mês</b> (IBS ' + money(y.liquido.saldoCredorIbs) + ' · CBS ' + money(y.liquido.saldoCredorCbs) + '). ' +
      'É saldo credor, não redução de outro tributo: o simulador não compensa esse valor entre IBS e CBS nem com ' +
      'ICMS, ISS, IPI ou IRPJ/CSLL.</div>';
  }

  h += '<div class="ft-rodape-ano"><span>Contabiliza · Lucro Real · Transição · Ano ' + y.ano + '</span>' +
       '<span>' + esc(P.empresa || 'Cliente não informado') + '</span></div>';
  return h + '</div>';
}

/** frase executiva do ano, com a mesma semântica da já aprovada */
function fraseExecutivaAno(y){
  var d = y.diferencaMes, pct = y.diferencaPct;
  var sufixo = (pct == null) ? '' : ' (' + (pct > 0 ? '+' : '') + pctFmt(pct, 1) + ')';
  if(d > 0.005)  return 'Em <b>' + y.ano + '</b>, a carga mensal sobre consumo <b>aumenta</b> em ' + money(d) + sufixo +
                        ' em relação à situação atual informada.';
  if(d < -0.005) return 'Em <b>' + y.ano + '</b>, a carga mensal sobre consumo <b>reduz</b> em ' + money(Math.abs(d)) + sufixo +
                        ' em relação à situação atual informada.';
  return 'Em <b>' + y.ano + '</b>, a carga mensal sobre consumo <b>permanece próxima</b> da situação atual informada.';
}

/* ---------------- PARTE 3 · encerramento ---------------- */

function ftPremissasTransicao(T){
  var h = '<div class="rp-sec" style="break-before:page">Premissas da transição</div>';
  h += '<div class="rp-panel"><div class="rp-ph">IBS e CBS considerados em cada ano</div>';
  h += '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Ano</th><th>IBS</th><th>Origem</th>' +
       '<th>CBS</th><th>Origem</th></tr></thead><tbody>';
  T.forEach(function(y){
    var r = regrasDoAno(FISCAL_RULES, y.ano);
    h += '<tr><td>' + y.ano + '</td>' +
         '<td>' + pctFmt(r.ibs.valor) + '</td>' +
         '<td style="text-align:left">' + tagStatus(r.ibs.status) + '</td>' +
         '<td>' + pctFmt(r.cbs.valor) + '</td>' +
         '<td style="text-align:left">' + tagStatus(r.cbs.status) + '</td></tr>';
  });
  h += '</tbody></table></div></div>';

  h += '<div class="rp-panel"><div class="rp-ph">ICMS, ISS e IPI considerados em cada ano</div>';
  h += '<div class="table-scroll"><table class="rp-tab"><thead><tr><th>Ano</th><th>ICMS remanescente</th><th>Origem</th>' +
       '<th>ISS remanescente</th><th>Origem</th><th>IPI mantido</th></tr></thead><tbody>';
  T.forEach(function(y){
    var r = regrasDoAno(FISCAL_RULES, y.ano);
    h += '<tr><td>' + y.ano + '</td>' +
         '<td>' + pctFmt(r.icmsRemanescente.valor, 0) + '</td>' +
         '<td style="text-align:left">' + tagStatus(r.icmsRemanescente.status) + '</td>' +
         '<td>' + pctFmt(r.issRemanescente.valor, 0) + '</td>' +
         '<td style="text-align:left">' + tagStatus(r.issRemanescente.status) + '</td>' +
         '<td>' + pctFmt(r.ipiPadrao.valor, 0) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<div class="rp-foot" style="margin-top:10px">Percentuais marcados como <b>Personalizado</b> foram alterados por ' +
       'você nas premissas avançadas e valem apenas para o ano correspondente. <b>Estimativa atual</b> e <b>Projeção</b> ' +
       'não são alíquotas legalmente definitivas.</div>';
  return h + '</div>';
}

function ftMetodologia(P){
  var h = '<div class="rp-panel"><div class="rp-ph">Metodologia e observações</div><div class="rp-diag">';
  h += '<p>Todos os anos deste documento vêm da mesma simulação: a composição econômica informada é projetada ' +
       'para cada ano da transição usando as alíquotas e os fatores daquele ano. Nenhum ano é estimado por ' +
       'interpolação nem por regra própria de apresentação.</p>';
  h += '<p>Para fins de leitura deste simulador, o <b>IBS integra o grupo “Estaduais e municipais”</b> por possuir ' +
       'competência compartilhada entre Estados, Distrito Federal e Municípios. Não é realizado rateio interno ' +
       'entre essas esferas.</p>';
  h += '<p>Os <b>encargos trabalhistas/previdenciários</b>, o <b>IRPJ</b> e a <b>CSLL</b> são médias históricas informadas, ' +
       'não recalculadas pela Reforma nem por esta ferramenta, e permanecem constantes em todos os anos. Por não ' +
       'serem tributos sobre o consumo, aparecem separados da carga tributária e apenas na carga completa.</p>';
  h += '<p>O crédito de IBS abate somente IBS e o de CBS somente CBS. Quando o crédito utilizável supera o débito, ' +
       'o excedente é apresentado como <b>saldo credor</b> do ano, sem reduzir os demais tributos do cenário.</p>';
  h += '<p>A memória detalhada de um ano específico pode ser emitida no simulador pela opção ' +
       '<b>“Gerar relatório com cálculos”</b>, selecionando o ano desejado antes de gerar.</p>';
  return h + '</div></div>';
}

/* =====================================================================
   B · RELATÓRIO COM CÁLCULOS
   ===================================================================== */
function montarCorpoCalculos(P, R, T, C){
  /* 2 · carga tributária sobre o faturamento + memória */
  $('rp_carga').innerHTML = tabelaCarga(C);
  $('rp_cargaNota').innerHTML = notaCarga(C);
  $('rp_cargaMemo').innerHTML = memoriaCarga(C);

  /* 3 · formação da situação atual */
  var dt = P.atualDetalhe || {};
  var ta = '<thead><tr><th>Tributo</th><th>Origem</th><th>Média mensal</th><th>Projeção anual</th></tr></thead><tbody>';
  componentesPisCofins(R, P).map(function(c){ return [c.rotulo, c.valor, c.combinado ? dt.pisCofins : c.det]; })
   .concat(componentesLegados(R, P, false).map(function(c){ return [c.rotulo, c.valor, c.det]; }))
   .forEach(function(l){
    var d = l[2] || { modo:'VALUE', origemStatus:'HISTORICAL' };
    ta += '<tr><td>' + l[0] + '</td>' +
          '<td style="text-align:left">' + tagStatus(d.origemStatus || 'HISTORICAL') +
          '<div style="font-weight:400;color:#7f8083;font-size:.78rem;margin-top:3px">' + esc(textoOrigem(d)) + '</div></td>' +
          '<td>' + money(l[1]) + '</td><td>' + money(l[1] * 12) + '</td></tr>';
  });
  ta += '</tbody><tfoot><tr><td>Total atual</td><td></td><td>' + money(R.atual.total) + '</td><td>' + money(R.atual.total * 12) + '</td></tr></tfoot>';
  $('rp_atual').innerHTML = ta;
  $('rp_atualMemo').innerHTML = notaModeloAnterior(P) + calcMemoriaAtual(P, R);

  /* 4 · operações e receitas */
  $('rp_operacoes').innerHTML = calcBlocosOperacoes(P, R);

  var tb = '<thead><tr><th>Descrição</th><th>Valor mensal</th><th>Tratamento</th><th>Alíquota aplicada</th><th>Créditos das aquisições</th></tr></thead><tbody>';
  R.tratamento.linhas.forEach(function(l){
    var trat = null;
    FISCAL_RULES.tratamentosReceita.forEach(function(x){ if(x.id === l.tratamento) trat = x; });
    var regra = (trat && trat.creditTreatment) || 'MAINTAIN';
    tb += '<tr><td>' + esc(l.descricao) + '</td><td>' + money(l.valor) + '</td><td>' + esc(trat ? trat.rotulo : l.tratamento) + '</td>' +
          '<td>' + pctFmt(l.fatorAliquota * 100, 0) + ' da alíquota do ano</td>' +
          '<td style="text-align:left">' + (regra === 'PROPORTIONAL_REVERSAL' ? 'Anulação proporcional' : 'Mantém os créditos') + '</td></tr>';
  });
  tb += '</tbody><tfoot><tr><td>Receita total analisada</td><td>' + money(R.tratamento.faturamento) +
        '</td><td colspan="3">cada linha é tributada pela sua própria alíquota efetiva</td></tr></tfoot>';
  $('rp_beneficios').innerHTML = tb;

  /* 5 · formação do cenário Reforma */
  var tr = '<thead><tr><th>Tributo</th><th>Média mensal</th><th>Projeção anual</th></tr></thead><tbody>';
  tr += '<tr><td>IBS — débito</td><td>' + money(R.debito.ibs) + '</td><td>' + money(R.debito.ibs * 12) + '</td></tr>';
  tr += '<tr><td>CBS — débito</td><td>' + money(R.debito.cbs) + '</td><td>' + money(R.debito.cbs * 12) + '</td></tr>';
  tr += '<tr><td>(−) Crédito utilizável de IBS/CBS</td><td>−' + money(R.credito.total) + '</td><td>−' + money(R.credito.total * 12) + '</td></tr>';
  tr += '<tr><td>ICMS remanescente (' + pctFmt(R.legado.fatorIcms, 0) + ')</td><td>' + money(R.legado.icms) + '</td><td>' + money(R.legado.icms * 12) + '</td></tr>';
  tr += '<tr><td>ISS remanescente (' + pctFmt(R.legado.fatorIss, 0) + ')</td><td>' + money(R.legado.iss) + '</td><td>' + money(R.legado.iss * 12) + '</td></tr>';
  tr += '<tr><td>IPI residual / ZFM</td><td>' + money(R.legado.ipi) + '</td><td>' + money(R.legado.ipi * 12) + '</td></tr>';
  tr += '<tr><td>Imposto Seletivo</td><td>' + money(R.seletivo.valor) + '</td><td>' + money(R.seletivo.valor * 12) + '</td></tr>';
  tr += '<tr><td>PIS/Cofins</td><td>extintos</td><td>extintos</td></tr>';
  if(R.liquido.saldoCredorTotal > 0){
    tr += '<tr><td>Saldo credor estimado (não compensado no cenário)</td><td>' + money(R.liquido.saldoCredorTotal) +
          '</td><td>' + money(R.liquido.saldoCredorTotal * 12) + '</td></tr>';
  }
  tr += '</tbody><tfoot><tr><td>Total projetado</td><td>' + money(R.consumoReforma) + '</td><td>' + money(R.consumoReforma * 12) + '</td></tr></tfoot>';
  $('rp_reforma').innerHTML = tr;

  /* 6 · memória do débito */
  $('rp_memoDebito').innerHTML = memoriaIbsCbs(R) + calcNotaReducaoPersonalizada(R) + calcNotaExportacao(R);

  /* 7 · créditos e estornos */
  $('rp_creditos').innerHTML = tabelaCreditos(R) + blocoOrigemCreditos(R) + explicacaoEstorno(R, true);

  /* 8 · trajetória */
  var tt = '<thead><tr><th>Ano</th><th>Consumo — atual</th><th>Consumo — Reforma</th><th>Impacto</th><th>Carga tributária</th><th>% do faturamento</th><th>Carga completa</th></tr></thead><tbody>';
  T.forEach(function(y){
    var d = y.diferencaMes;
    var cy = calculateTaxBurdenBreakdown(y, P).reforma.tributaria;
    var foco = (String(y.ano) === String(R.ano));
    tt += '<tr' + (foco ? ' class="ano-foco"' : '') + '><td>' + y.ano + (foco ? ' · ano analisado' : '') + '</td>' +
          '<td>' + money(y.consumoAtual) + '</td><td>' + money(y.consumoReforma) + '</td>' +
          '<td class="' + (d > 0.005 ? 'up' : (d < -0.005 ? 'down' : '')) + '">' + (d > 0 ? '+' : '') + money(d) + '</td>' +
          '<td>' + money(cy.valor) + '</td>' +
          '<td>' + (cy.pct == null ? 'não aplicável' : pctFmt(cy.pct)) + '</td>' +
          '<td>' + money(y.completaReforma) + '</td></tr>';
  });
  tt += '</tbody>';
  $('rp_traj').innerHTML = tt;
  $('rp_grafico').innerHTML = graficoLinha(T, R.ano);
  $('rp_legenda').innerHTML = legendaGrafico().replace('<div class="rp-leg">', '').replace('</div>', '');

  /* 9 · visão completa + memória dos históricos */
  var c = R.complementar;
  var tc = '<thead><tr><th>Componente</th><th>Natureza</th><th>Situação atual</th><th>Cenário ' + R.ano + '</th></tr></thead><tbody>';
  tc += '<tr><td>Tributos sobre consumo</td><td>' + tagStatus('USER_INPUT') + ' / projetado</td><td>' + money(R.atual.total) + '</td><td>' + money(R.consumoReforma) + '</td></tr>';
  componentesIrpjCsll(P, R).forEach(function(x){
    tc += '<tr><td>' + esc(x.rotulo) + '</td><td>' + tagStatus('HISTORICAL') + '</td><td>' + money(x.mensal) + '</td><td>' + money(x.mensal) + '</td></tr>';
  });
  tc += '<tr><td>Encargos patronais</td><td>' + tagStatus('HISTORICAL') + '</td><td>' + money(c.encargosPatronais) + '</td><td>' + money(c.encargosPatronais) + '</td></tr>';
  tc += '<tr><td>Encargos de pró-labore</td><td>' + tagStatus('HISTORICAL') + '</td><td>' + money(c.encargosProLabore) + '</td><td>' + money(c.encargosProLabore) + '</td></tr>';
  tc += '</tbody><tfoot><tr><td>Total por mês</td><td></td><td>' + money(R.completaAtual) + '</td><td>' + money(R.completaReforma) + '</td></tr>' +
        '<tr><td>Total por ano</td><td></td><td>' + money(R.completaAtual * 12) + '</td><td>' + money(R.completaReforma * 12) + '</td></tr></tfoot>';
  $('rp_completa').innerHTML = tc;
  $('rp_complMemo').innerHTML = calcMemoriaComplementar(P, R);

  /* 10 · premissas — no documento nunca são botões */
  $('rp_premissas').innerHTML = tabelaPremissas(listaPremissasUsadas(P, R));

  /* 11 · diagnóstico técnico */
  $('rp_diag').innerHTML = calcDiagnostico(P, R, C);
}

/** memória VALUE/RATE da situação atual, reaproveitando o bloco já validado */
function calcMemoriaAtual(P, R){
  var det = (P && P.atualDetalhe) || {};
  var h = '<div class="vc-body">';
  if(P.currentRevenueMode === 'DETAILED' && P.atualDetalhado){
    var n = P.atualDetalhado.linhas.length;
    h += '<div class="vc-c">Os tributos atuais vêm da soma de <b>' + n + (n === 1 ? ' operação' : ' operações') +
         '</b> detalhadas. Os campos gerais da situação atual não participam do cálculo neste modo. ' +
         'A abertura por operação está na seção seguinte.</div>';
    componentesPisCofins(R, P).forEach(function(c){
      h += '<div class="vc-l"><span>' + esc(c.rotulo) + '</span><b>' + money(c.valor) + '</b></div>';
      h += '<div class="vc-c">' + esc(textoOrigem(c.combinado ? det.pisCofins : (c.det || {}))) + '</div>';
    });
    [['ICMS','icms'],['ISS','iss'],['IPI','ipi']].forEach(function(par){
      h += '<div class="vc-l"><span>' + par[0] + '</span><b>' + money(R.atual[par[1]]) + '</b></div>';
      h += '<div class="vc-c">' + esc(textoOrigem(det[par[1]] || {})) + '</div>';
    });
  } else {
    componentesPisCofins(R, P).forEach(function(c){
      var d = c.det || {};
      h += '<div class="vc-l"><span>' + esc(c.rotulo) + '</span><b>' + money(c.valor) + '</b></div>';
      if(d.modo === 'RATE' && d.base != null){
        h += '<div class="vc-c">Base ' + money(d.base) + ' · alíquota ' + pctAliq(d.aliquota) +
             ' · cálculo: ' + money(d.base) + ' × ' + pctAliq(d.aliquota) + ' = <b>' + money(d.valor) + '</b></div>';
      } else {
        h += '<div class="vc-c">Valor mensal informado: <b>' + money(c.valor) + '</b>' +
             (c.combinado ? ' · em valor combinado, preservado do registro anterior' : '') + '</div>';
      }
    });
    [['ICMS','icms'],['ISS','iss'],['IPI','ipi']].forEach(function(par){
      var d = det[par[1]] || {};
      h += '<div class="vc-l"><span>' + par[0] + '</span><b>' + money(R.atual[par[1]]) + '</b></div>';
      if(d.modo === 'RATE'){
        if(d.pis && d.cofins){
          h += '<div class="vc-c">PIS — base ' + money(d.pis.base) + ' · alíquota ' + pctAliq(d.pis.aliquota) +
               ' · cálculo: ' + money(d.pis.base) + ' × ' + pctAliq(d.pis.aliquota) + ' = <b>' + money(d.pis.valor) + '</b></div>';
          h += '<div class="vc-c">Cofins — base ' + money(d.cofins.base) + ' · alíquota ' + pctAliq(d.cofins.aliquota) +
               ' · cálculo: ' + money(d.cofins.base) + ' × ' + pctAliq(d.cofins.aliquota) + ' = <b>' + money(d.cofins.valor) + '</b></div>';
          h += '<div class="vc-c">Total: <b>' + money(d.valor) + '</b></div>';
        } else {
          h += '<div class="vc-c">Base ' + money(d.base) + ' · alíquota ' + pctAliq(d.aliquota) +
               ' · cálculo: ' + money(d.base) + ' × ' + pctAliq(d.aliquota) + ' = <b>' + money(d.valor) + '</b></div>';
        }
      } else {
        h += '<div class="vc-c">Valor mensal informado: <b>' + money(d.valor != null ? d.valor : R.atual[par[1]]) +
             '</b> · ' + esc(textoOrigem(d)) + '</div>';
      }
    });
  }
  h += '<div class="vc-l vc-eq"><span>Total atual</span><b>' + money(R.atual.total) + '</b></div>';
  return h + '</div>';
}

/** uma operação por bloco compacto: legível na A4, sem esmagar dez colunas */
function calcBlocosOperacoes(P, R){
  var d = P.atualDetalhado;
  if(!d || !d.linhas || !d.linhas.length){
    return '<div class="rp-panel"><div class="rp-ph">Composição do faturamento</div>' +
      '<div class="rp-foot">A simulação está no <b>modo simples</b>: o faturamento não foi detalhado por operação. ' +
      'Os tributos atuais vêm dos campos gerais e os tratamentos da Reforma, das linhas de receita com tratamento específico.</div></div>';
  }
  // débito por descrição, vindo da memória já calculada pelo motor
  var porDesc = {};
  R.tratamento.linhas.forEach(function(l){ porDesc[l.descricao] = l; });
  var ai = R.aliquotas.ibs, ac = R.aliquotas.cbs;

  var h = '<div class="rp-panel"><div class="rp-ph">Operações detalhadas — ' + d.linhas.length +
          (d.linhas.length === 1 ? ' operação' : ' operações') + '</div>';
  d.linhas.forEach(function(l){
    var eng = porDesc[l.descricao];
    var fator = eng ? eng.fatorAliquota : null;
    var ibsEf = fator == null ? null : ai * fator;
    var cbsEf = fator == null ? null : ac * fator;
    h += '<div class="op-bloco">';
    h += '<div class="op-h"><b>' + esc(l.descricao) + '</b>' +
         '<span>' + esc(l.naturezaRotulo) + ' · faturamento ' + money(l.faturamento) + '</span></div>';
    h += '<div class="op-cols">';
    h += '<div class="op-c"><div class="op-ct">Situação atual</div>' +
      linhasPisCofinsDaOperacao(l, '<div class="op-l"><span>', '</span><b>', '</b></div>') +
      '<div class="op-l"><span>ICMS</span><b>' + money(l.icms) + '</b></div>' +
      '<div class="op-l"><span>ISS</span><b>' + money(l.iss) + '</b></div>' +
      '<div class="op-l"><span>IPI</span><b>' + money(l.ipi) + '</b></div>' +
      '<div class="op-l tot"><span>Tributos atuais</span><b>' + money(l.tributos) + '</b></div>' +
      '<div class="op-l"><span>Carga efetiva</span><b>' + (l.cargaEfetiva == null ? '—' : pctFmt(l.cargaEfetiva)) + '</b></div>' +
      '</div>';
    h += '<div class="op-c ref"><div class="op-ct">Reforma ' + R.ano + '</div>' +
      '<div class="op-l"><span>Tratamento</span><b>' + esc(l.tratamentoRotulo || '—') + '</b></div>' +
      (fator == null ? '<div class="op-l"><span>Fator</span><b>—</b></div>'
                     : '<div class="op-l"><span>Fator do tratamento</span><b>' + pctFmt(fator * 100, 0) + '</b></div>') +
      '<div class="op-l"><span>IBS efetivo</span><b>' + (ibsEf == null ? '—' : pctAliq(ibsEf)) + '</b></div>' +
      '<div class="op-l"><span>CBS efetiva</span><b>' + (cbsEf == null ? '—' : pctAliq(cbsEf)) + '</b></div>' +
      '<div class="op-l"><span>Débito IBS</span><b>' + (eng ? money(l.faturamento * ibsEf / 100) : '—') + '</b></div>' +
      '<div class="op-l"><span>Débito CBS</span><b>' + (eng ? money(l.faturamento * cbsEf / 100) : '—') + '</b></div>' +
      '</div>';
    h += '</div>';
    if(l.pctCustom != null){
      h += '<div class="op-pers"><b>Redução personalizada:</b> percentual informado ' + pctFmt(l.pctCustom, 0) +
           ' · fator restante ' + pctFmt(100 - l.pctCustom, 0) + ' · IBS padrão ' + pctAliq(ai) +
           ' → IBS efetivo ' + pctAliq(ibsEf) + ' · CBS padrão ' + pctAliq(ac) + ' → CBS efetiva ' + pctAliq(cbsEf) + '.</div>';
    }
    h += '</div>';
  });
  h += '<div class="rp-foot" style="margin-top:6px"><b>Carga efetiva</b> é a relação entre os tributos informados e a ' +
       'receita da própria operação — não é alíquota fiscal. Os débitos de IBS e CBS por operação reproduzem, ' +
       'linha a linha, a memória de cálculo do débito apresentada adiante.</div>';
  return h + '</div>';
}

/** detalhe adicional das reduções personalizadas, quando existirem */
function calcNotaReducaoPersonalizada(R){
  var linhas = R.tratamento.linhas.filter(function(l){ return l.tratamento === 'RED_CUSTOM' && l.valor > 0; });
  if(!linhas.length) return '';
  var ai = R.aliquotas.ibs, ac = R.aliquotas.cbs;
  var h = '<div class="memo-n"><b>Reduções personalizadas informadas.</b><ul style="margin:6px 0 0 18px">';
  linhas.forEach(function(l){
    var pct = (l.pctCustom == null) ? (100 - l.fatorAliquota * 100) : l.pctCustom;
    h += '<li>' + esc(l.descricao) + ' — redução informada ' + pctFmt(pct, 0) +
         ', fator restante ' + pctFmt(l.fatorAliquota * 100, 0) +
         '. IBS padrão ' + pctAliq(ai) + ' → efetivo ' + pctAliq(ai * l.fatorAliquota) +
         '; CBS padrão ' + pctAliq(ac) + ' → efetiva ' + pctAliq(ac * l.fatorAliquota) +
         '. Débito: ' + money(l.valor) + ' × ' + pctAliq(ai * l.fatorAliquota) + ' = ' +
         money(l.valor * ai * l.fatorAliquota / 100) + ' de IBS e ' +
         money(l.valor * ac * l.fatorAliquota / 100) + ' de CBS.</li>';
  });
  return h + '</ul></div>';
}

/** exportação nunca é agrupada com imunidade geral */
function calcNotaExportacao(R){
  var exp = R.tratamento.linhas.filter(function(l){ return l.tratamento === 'EXPORTACAO' && l.valor > 0; });
  if(!exp.length) return '';
  var total = exp.reduce(function(a, l){ return a + l.valor; }, 0);
  return '<div class="memo-n"><b>Exportações — tratamento próprio.</b> ' + money(total) +
    ' de receita foi informada como exportação. Neste simulador a exportação gera <b>débito zero</b> de IBS e CBS, ' +
    '<b>preserva os créditos</b> das aquisições e <b>não entra na proporção de estorno</b>. ' +
    'É um tratamento distinto de “Imunidade — outras hipóteses”, que segue a regra geral de anulação proporcional.</div>';
}

/** memória dos valores históricos e do Imposto Seletivo */
function calcMemoriaComplementar(P, R){
  var c = R.complementar;
  var ent = P.irpjEntrada || { periodicidade:'MENSAL', informado:c.irpjCsll };
  var h = '<div class="vc-body">';
  h += '<div class="vc-cols">';
  componentesIrpjCsll(P, R).forEach(function(x){
    h += '<div class="vc-bloco">';
    h += '<div class="vc-t">' + esc(x.rotulo) + '</div>';
    if(x.periodicidade === 'TRIMESTRAL'){
      h += '<div class="vc-c">Periodicidade: <b>trimestral</b>. Informado: ' + money(x.informado) + '.</div>';
      h += '<div class="vc-c">' + money(x.informado) + ' ÷ 3 = <b>' + money(x.mensal) + ' por mês</b></div>';
    } else {
      h += '<div class="vc-c">Periodicidade: <b>mensal</b>. Informado: ' + money(x.informado) + '.</div>';
    }
    h += '<div class="vc-l"><span>Valor mensal utilizado</span><b>' + money(x.mensal) + '</b></div>';
    h += '</div>';
  });
  h += '</div>';
  h += '<div class="vc-bloco">';
  // linha de TOTAL, logo abaixo das linhas individuais — não é um rótulo de entrada
  h += '<div class="vc-l vc-eq"><span>Total de IRPJ e CSLL utilizado na carga completa</span><b>' + money(c.irpjCsll) + ' por mês</b></div>';
  h += '<div class="vc-c">O valor trimestral informado nunca é anualizado diretamente: a ferramenta trabalha com a média mensal.</div>';
  h += '</div>';

  h += '<div class="vc-bloco">';
  h += '<div class="vc-t">Encargos trabalhistas/previdenciários</div>';
  h += '<div class="vc-l"><span>Encargos patronais</span><b>' + money(c.encargosPatronais) + '</b></div>';
  h += '<div class="vc-l"><span>Encargos de pró-labore</span><b>' + money(c.encargosProLabore) + '</b></div>';
  h += '<div class="vc-l vc-eq"><span>Total de encargos</span><b>' + money(c.encargosPatronais + c.encargosProLabore) + '</b></div>';
  h += '<div class="vc-c">São <b>valores históricos informados</b>, não recalculados pela Reforma nem por esta ferramenta, ' +
       'e mantidos iguais em todos os anos simulados. <b>Não são tributos</b> e por isso aparecem fora da carga tributária.</div>';
  h += '</div>';

  h += '<div class="vc-bloco">';
  h += '<div class="vc-t">Imposto Seletivo</div>';
  if(!R.seletivo.aplicavel){
    h += '<div class="vc-c">A empresa não foi sinalizada como sujeita ao Imposto Seletivo. Valor considerado: <b>' +
         money(R.seletivo.valor) + '</b>.</div>';
  } else {
    var catRot = null;
    FISCAL_RULES.impostoSeletivo.categorias.forEach(function(x){ if(x.id === R.seletivo.categoria) catRot = x.rotulo; });
    h += '<div class="vc-l"><span>Categoria informada</span><b>' + esc(catRot || R.seletivo.categoria || 'não informada') + '</b></div>';
    h += '<div class="vc-l"><span>Base mensal informada</span><b>' + money(R.seletivo.base) + '</b></div>';
    h += '<div class="vc-l"><span>Alíquota considerada</span><b>' + pctAliq(R.seletivo.aliquota) + '</b></div>';
    h += '<div class="vc-l vc-eq"><span>Imposto Seletivo</span><b>' + money(R.seletivo.valor) + '</b></div>';
    if(R.seletivo.status === 'PENDING_LAW'){
      h += '<div class="vc-c"><b>Pendente de lei:</b> nenhuma alíquota foi informada e o simulador não presume percentual. ' +
           'O IS permanece em ' + money(R.seletivo.valor) + '.</div>';
    }
    if(R.seletivo.aviso) h += '<div class="vc-c">' + esc(R.seletivo.aviso) + '</div>';
  }
  h += '</div>';
  return h + '</div>';
}

/** diagnóstico técnico — descritivo, sem recomendação de conduta */
function calcDiagnostico(P, R, C){
  var diag = '';
  diag += '<p>No ano de <b>' + R.ano + '</b>, os tributos sobre consumo passariam de <b>' + money(R.atual.total) +
          '</b> para <b>' + money(R.consumoReforma) + '</b> por mês, uma variação de <b>' + (R.diferencaMes > 0 ? '+' : '') + money(R.diferencaMes) +
          '</b> (' + (R.diferencaPct == null ? 'não aplicável' : ((R.diferencaPct > 0 ? '+' : '') + pctFmt(R.diferencaPct, 1))) +
          '), equivalente a <b>' + (R.diferencaAno > 0 ? '+' : '') + money(R.diferencaAno) + '</b> no ano.</p>';
  diag += '<p>Calculados linha a linha conforme os tratamentos e as alíquotas efetivas de cada receita, o IBS e a CBS geram ' +
          'débito total de <b>' + money(R.debito.total) + '</b>, contra um crédito potencial bruto de <b>' + money(R.creditoBruto.total) + '</b>.</p>';
  if(R.estorno.aplicavel){
    diag += '<p><b>Estorno de créditos:</b> ' + money(R.estorno.receitaEstorno) + ' da receita total de ' + money(R.estorno.receitaTotal) +
            ' está sujeita à anulação proporcional de créditos (isenção e/ou imunidade), o que corresponde a <b>' + pctFmt(R.estorno.percentualEstorno) +
            '</b>. O estorno estimado é de <b>' + money(R.estorno.estorno.total) + '</b> e o crédito utilizável cai para <b>' + money(R.credito.total) +
            '</b>. Reduções de alíquota, alíquota zero e exportações não entram nessa proporção.</p>';
  } else {
    diag += '<p><b>Estorno de créditos:</b> nenhuma receita do período exige anulação proporcional. ' +
            'O crédito utilizável é igual ao crédito potencial bruto, <b>' + money(R.credito.total) + '</b>.</p>';
  }
  if(R.liquido.saldoCredorTotal > 0){
    diag += '<p><b>Saldo credor:</b> nesta configuração o crédito utilizável supera o débito em <b>' + money(R.liquido.saldoCredorTotal) +
            '</b> por mês. O simulador mantém esse saldo em linha própria e não o utiliza para reduzir os demais tributos do cenário.</p>';
  }
  diag += '<p><b>Carga sobre o faturamento:</b> a carga tributária passa de <b>' + money(C.atual.tributaria.valor) + '</b> (' +
          (C.atual.tributaria.pct == null ? 'não aplicável' : pctFmt(C.atual.tributaria.pct)) + ' do faturamento) para <b>' +
          money(C.reforma.tributaria.valor) + '</b> (' + (C.reforma.tributaria.pct == null ? 'não aplicável' : pctFmt(C.reforma.tributaria.pct)) +
          '). Os encargos trabalhistas/previdenciários somam <b>' + money(C.atual.encargos.valor) + '</b> (' +
          (C.atual.encargos.pct == null ? 'não aplicável' : pctFmt(C.atual.encargos.pct)) + ') e permanecem iguais nos dois cenários.</p>';
  diag += '<p>Somando os valores históricos de IRPJ, CSLL, encargos patronais e encargos de pró-labore, a carga completa considerada seria de <b>' +
          money(R.completaReforma) + '</b> por mês, ante <b>' + money(R.completaAtual) + '</b> na situação atual. ' +
          'Esses componentes são <b>médias históricas informadas</b> e permanecem inalterados em todos os anos desta simulação.</p>';
  if(P.revenueModelUnified){
    diag += '<p><b>Origem das receitas:</b> a composição do faturamento veio do detalhamento unificado por operação. ' +
            'Cada linha traz os tributos atuais e o tratamento de IBS/CBS escolhido pelo usuário — o simulador não deduz ' +
            'tratamento a partir dos valores informados.</p>';
  }
  if(R.seletivo.aplicavel && R.seletivo.status === 'PENDING_LAW'){
    diag += '<p><b>Imposto Seletivo:</b> a empresa foi sinalizada como sujeita ao IS, mas nenhuma alíquota foi informada. ' +
            'O simulador não presume percentual e mantém o IS em R$ 0,00.</p>';
  }
  if(R.seletivo.aviso){ diag += '<p><b>Observação sobre o IS:</b> ' + esc(R.seletivo.aviso) + '</p>'; }
  return diag;
}

function dataBaseBR(){
  var p = FISCAL_RULES.meta.dataBase.split('-');
  return p[2]+'/'+p[1]+'/'+p[0];
}

/* =====================================================================
   CLIENTES SALVOS
   ===================================================================== */
var CAMPOS_TEXTO = ['empresa','cnpj','segmento','irpjPeriodicidade'];
var CAMPOS_NUM = ['faturamento','compras','pctCreditavel','pctB2B','pctExportacao',
  'atualPis','atualCofins','atualPisCofins','atualIcms','atualIss','atualIpi',
  'irpj','csll','irpjCsll','encargosPatronais','encargosProLabore',
  'isBase','isAliquota','ipiResidualValor','reducaoGeral','ano'];
/* campos do modo RATE — acrescentados na Sprint 02.
   Clientes salvos antes disso não os possuem: são semeados pela configuração. */
var CAMPOS_RATE = ['pisBase','pisAliq','cofinsBase','cofinsAliq',
  'icmsBase','icmsAliq','issBase','issAliq','ipiBase','ipiAliq'];
var CAMPOS_CHECK = ['forcarTodos','isSujeita','isUsarCustom','ipiResidualAtivo'];

function coletarFormulario(){
  var o = { campos:{}, checks:{}, receitas:[], premissas:[], isCategoria:$('isCategoria').value,
            modos:{}, versao:2 };
  CAMPOS_TEXTO.concat(CAMPOS_NUM, CAMPOS_RATE).forEach(function(id){ o.campos[id] = $(id).value; });
  CAMPOS_CHECK.forEach(function(id){ o.checks[id] = $(id).checked ? 1 : 0; });
  TRIBUTOS_MODO.forEach(function(t){ o.modos[t] = modosTributo[t]; });
  o.receitas = receitasEspeciais.map(function(l){
    return { descricao:l.descricao, valor:l.valor, tratamento:l.tratamento, pctCustom:l.pctCustom };
  });
  o.premissas = coletarCustomizacoes();
  // Sprint 04: modo de crédito das compras e grupos detalhados
  o.currentRevenueMode = currentRevenueMode;
  // Sprint 08.1: versão do esquema de detalhamento de receitas.
  // 2 = tabela unificada; 1 = modelo separado. O namespace de clientes NÃO muda.
  o.revenueDetailSchemaVersion = revenueDetailSchemaVersion;
  /* Sprint 10.2.2: um registro salvo agora nunca guarda agregado como entrada.
     Se a migração ainda estiver pendente, o valor antigo é gravado tal como
     estava, para que nada se perca até a revisão. Depois de confirmada, sobra
     apenas o metadado de auditoria, que não participa de cálculo nenhum. */
  o.pisCofinsPendenteLegado = pisCofinsPendenteLegado;
  o.pisCofinsLegadoValor = pisCofinsPendenteLegado ? pisCofinsLegadoValor : 0;
  o.pisCofinsLegadoAuditoria = pisCofinsLegadoAuditoria;
  o.irpjCsllPendenteLegado = irpjCsllPendenteLegado;
  o.irpjCsllLegadoValor = irpjCsllPendenteLegado ? irpjCsllLegadoValor : 0;
  o.irpjCsllLegadoPeriodicidade = irpjCsllLegadoPeriodicidade;
  o.irpjCsllLegadoAuditoria = irpjCsllLegadoAuditoria;
  /* Sprint 10.2.1 — a linha unificada guarda PIS e Cofins separados. Gravar
     apenas o antigo agregado apagava os dois valores no próximo carregamento.
     Linha já separada grava pis/cofins; linha ainda combinada grava pisCofins.
     Os dois formatos nunca coexistem na mesma linha, para não haver ambiguidade
     sobre qual é a verdade daquele registro. */
  o.receitasDetalhadasUnificadas = receitasDetalhadasUnificadas.map(function(l){
    var g = { descricao:l.descricao, natureza:l.natureza, faturamento:l.faturamento,
              icms:l.icms, iss:l.iss, ipi:l.ipi,
              tratamentoReforma:l.tratamentoReforma, pctCustom:l.pctCustom };
    if(linhaTemPisCofinsSeparado(l)){ g.pis = l.pis; g.cofins = l.cofins; }
    else { g.pisCofins = l.pisCofins; }
    return g;
  });
  // backup do modelo anterior, preservado para rastreabilidade após consolidar
  o.legadoDetalheBackup = legadoDetalheBackup;
  o.receitasAtuaisDetalhadas = receitasAtuaisDetalhadas.map(function(l){
    return { descricao:l.descricao, natureza:l.natureza, faturamento:l.faturamento,
             pisCofins:l.pisCofins, icms:l.icms, iss:l.iss, ipi:l.ipi };
  });
  o.purchaseCreditMode = purchaseCreditMode;
  o.gruposCompras = gruposCompras.map(function(g){
    return { descricao:g.descricao, valor:g.valor, tipo:g.tipo,
             reducao:g.reducao, fatorIbs:g.fatorIbs, fatorCbs:g.fatorCbs,
             aliquotaCreditoIbs:g.aliquotaCreditoIbs, aliquotaCreditoCbs:g.aliquotaCreditoCbs };
  });
  return o;
}

function aplicarFormulario(o){
  if(!o) return;

  // base limpa dos campos de alíquota: clientes da Sprint 01 não os possuem
  semearAliquotasDaConfig();
  CAMPOS_RATE.forEach(function(id){ if(/Base$/.test(id)) $(id).value = '0'; });

  CAMPOS_TEXTO.concat(CAMPOS_NUM, CAMPOS_RATE).forEach(function(id){
    if(o.campos && o.campos[id] !== undefined) $(id).value = o.campos[id];
  });
  CAMPOS_CHECK.forEach(function(id){
    if(o.checks && o.checks[id] !== undefined) $(id).checked = !!o.checks[id];
  });

  // compatibilidade retroativa: sem o mapa de modos, tudo é VALUE (Sprint 01)
  TRIBUTOS_MODO.forEach(function(t){
    var m = o.modos && o.modos[t];
    modosTributo[t] = (m === 'RATE') ? 'RATE' : 'VALUE';
  });

  receitasEspeciais = (o.receitas || []).map(function(l){
    // valores antigos vinham sem máscara: normaliza só a exibição
    var v = (l.valor === '' || l.valor == null) ? '' : formatarMoedaValor(parseBR(l.valor));
    return { descricao:l.descricao||'', valor:v, tratamento:l.tratamento||'INTEGRAL', pctCustom:l.pctCustom||'' };
  });

  // compatibilidade retroativa: sem o campo, o cliente é da Sprint 01/02/03 => SIMPLE
  if(!(o.campos && o.campos.irpjPeriodicidade)) $('irpjPeriodicidade').value = 'MENSAL';
  // sem os campos, o cliente é de versão anterior => situação atual em SIMPLE
  currentRevenueMode = (o.currentRevenueMode === 'DETAILED') ? 'DETAILED' : 'SIMPLE';

  /* Compatibilidade (Sprint 08.1). Registro sem revenueDetailSchemaVersion === 2
     que já possua detalhamento separado permanece no MODELO ANTERIOR. Nada é
     casado por descrição, valor, ordem ou natureza: não sabemos qual linha de
     uma lista corresponde a qual linha da outra, e não se inventa vínculo.
     O registro salvo não é alterado só por ter sido carregado. */
  var temLegado = (o.receitasAtuaisDetalhadas && o.receitasAtuaisDetalhadas.length > 0) ||
                  (o.receitas && o.receitas.length > 0);
  revenueDetailSchemaVersion = (o.revenueDetailSchemaVersion === UNIFICADO_SCHEMA)
    ? UNIFICADO_SCHEMA
    : (temLegado ? 1 : UNIFICADO_SCHEMA);
  clienteEmModeloAnterior = (revenueDetailSchemaVersion !== UNIFICADO_SCHEMA);

  /* Sprint 10.2.2 — agregado antigo vira PENDÊNCIA DE MIGRAÇÃO.
     Um registro anterior à separação traz apenas o total. Não se reparte por
     alíquota, metade nem qualquer proporção: os dois campos entram VAZIOS, o
     total antigo fica visível como referência e a simulação fica bloqueada até
     que o usuário informe a divisão. O modo RATE é exceção — ali a separação já
     existe nas próprias bases e alíquotas salvas.

     Carregar não altera o registro gravado: a pendência vive só na sessão até
     que o usuário confirme e salve. */
  var c = o.campos || {};
  function temValor(v){ return v !== undefined && v !== null && parseBR(v) > 0; }
  var modoPC = (o.modos && o.modos.pisCofins === 'RATE') ? 'RATE' : 'VALUE';

  pisCofinsLegadoAuditoria = o.pisCofinsLegadoAuditoria || null;
  irpjCsllLegadoAuditoria = o.irpjCsllLegadoAuditoria || null;

  var pcHerdado = (o.pisCofinsPendenteLegado === true) || (o.pisCofinsCombinadoLegado === true);
  pisCofinsPendenteLegado = modoPC === 'VALUE' &&
    (pcHerdado || (!temValor(c.atualPis) && !temValor(c.atualCofins) && temValor(c.atualPisCofins)));
  pisCofinsLegadoValor = pisCofinsPendenteLegado
    ? parseBR(o.pisCofinsLegadoValor || c.atualPisCofins || 0) : 0;

  var irHerdado = (o.irpjCsllPendenteLegado === true) || (o.irpjCsllCombinadoLegado === true);
  irpjCsllPendenteLegado = irHerdado || (!temValor(c.irpj) && !temValor(c.csll) && temValor(c.irpjCsll));
  irpjCsllLegadoValor = irpjCsllPendenteLegado
    ? parseBR(o.irpjCsllLegadoValor || c.irpjCsll || 0) : 0;
  // a periodicidade do registro antigo é preservada: nada é convertido em silêncio
  irpjCsllLegadoPeriodicidade = o.irpjCsllLegadoPeriodicidade ||
    ((c.irpjPeriodicidade === 'TRIMESTRAL') ? 'TRIMESTRAL' : 'MENSAL');

  /* Os campos separados nascem VAZIOS na migração: preenchê-los com o agregado,
     com metade dele ou com qualquer fração seria inventar a divisão. */
  if(pisCofinsPendenteLegado){
    $('atualPis').value = ''; $('atualCofins').value = '';
    $('atualPisCofins').value = formatarMoedaValor(pisCofinsLegadoValor);
  } else {
    $('atualPisCofins').value = '';
  }
  if(irpjCsllPendenteLegado){
    $('irpj').value = ''; $('csll').value = '';
    $('irpjCsll').value = formatarMoedaValor(irpjCsllLegadoValor);
    $('irpjPeriodicidade').value = irpjCsllLegadoPeriodicidade;
  } else {
    $('irpjCsll').value = '';
  }
  legadoDetalheBackup = o.legadoDetalheBackup || null;
  consolidacao = null;
  receitasDetalhadasUnificadas = (o.receitasDetalhadasUnificadas || []).map(function(l){
    var m = function(v){ return (v === '' || v == null) ? '' : formatarMoedaValor(parseBR(v)); };
    var r = { descricao:l.descricao||'', natureza:l.natureza||'outros', faturamento:m(l.faturamento),
              icms:m(l.icms), iss:m(l.iss), ipi:m(l.ipi),
              tratamentoReforma:l.tratamentoReforma || '', pctCustom:l.pctCustom || '' };
    /* A distinção precisa sobreviver à volta: uma linha antiga não pode receber
       pis/cofins vazios, senão o agregado combinado dela seria perdido. */
    if(linhaTemPisCofinsSeparado(l)){ r.pis = m(l.pis); r.cofins = m(l.cofins); }
    else { r.pisCofins = m(l.pisCofins); }
    return r;
  });

  receitasAtuaisDetalhadas = (o.receitasAtuaisDetalhadas || []).map(function(l){
    function fmt(v){ return (v === '' || v == null) ? '' : formatarMoedaValor(parseBR(v)); }
    return { descricao:l.descricao||'', natureza:l.natureza||'outros', faturamento:fmt(l.faturamento),
             pisCofins:fmt(l.pisCofins), icms:fmt(l.icms), iss:fmt(l.iss), ipi:fmt(l.ipi) };
  });
  purchaseCreditMode = (o.purchaseCreditMode === 'DETAILED') ? 'DETAILED' : 'SIMPLE';
  gruposCompras = (o.gruposCompras || []).map(function(g){
    var vg = (g.valor === '' || g.valor == null) ? '' : formatarMoedaValor(parseBR(g.valor));
    return { descricao:g.descricao||'', valor:vg, tipo:g.tipo||'REGULAR_FULL',
             reducao:g.reducao||'', fatorIbs:g.fatorIbs||'', fatorCbs:g.fatorCbs||'',
             aliquotaCreditoIbs:g.aliquotaCreditoIbs||'', aliquotaCreditoCbs:g.aliquotaCreditoCbs||'' };
  });

  aplicarCustomizacoes(o.premissas || []);
  if(o.isCategoria) $('isCategoria').value = o.isCategoria;
  renderTratamentos();
  sincronizarSegmento();
  sincronizarIS();
  atualizarAjudaIS();
  formatarCampoCNPJ(false);   // clientes salvos sem máscara passam a exibir formatado
  cnpjNomeAuto = '';
  cnpjUltimoConsultado = cnpjNumericoCompleto($('cnpj') && $('cnpj').value) || '';
  statusConsultaCNPJ('', '');
  normalizarTodosOsCamposMoeda();
  sincronizarIrpj();
  sincronizarPisCofins();
  sincronizarAliquotasAtuais();
  sincronizarTodosOsModos();
  renderReceitasAtuais();
  renderReceitasUnificadas();
  sincronizarModoAtual();
  renderGruposCompras();
  sincronizarModoCompras();
  // casos especiais nascem fechados, mas abrem sozinhos quando o cliente já tem dados
  $('boxReceitas').open = receitasEspeciais.length > 0;
  $('boxIS').open = $('isSujeita').checked;
  limparBloqueio();
  $('ipiResidualValor').disabled = !$('ipiResidualAtivo').checked;
  atualizarNotaAno();
  sincronizarSeletorAno();
  Array.prototype.forEach.call(document.querySelectorAll('select[data-enhanced="1"]'), sincronizarSeletorCustom);
}

function listarClientes(){
  var s = lerStore(), nomes = Object.keys(s.clientes || {}).sort(function(a,b){ return a.localeCompare(b,'pt-BR'); });
  var sel = $('clientList');
  var atual = sel.value;
  sel.innerHTML = '<option value="">'+(nomes.length ? 'Selecione um cliente' : 'Nenhum salvo')+'</option>' +
    nomes.map(function(n){ return '<option value="'+esc(n)+'">'+esc(n)+'</option>'; }).join('');
  if(nomes.indexOf(atual) >= 0) sel.value = atual;
  reconstruirOpcoesSeletor(sel);
}

function salvarCliente(){
  var nome = $('clientName').value.trim() || $('empresa').value.trim();
  if(!nome){ flash('Informe o nome do cliente para salvar.', true); return; }
  $('clientName').value = nome;
  var s = lerStore();
  s.clientes = s.clientes || {};
  s.clientes[nome] = { salvoEm: new Date().toISOString(), dados: coletarFormulario() };
  if(gravarStore(s)){ listarClientes(); $('clientList').value = nome; sincronizarSeletorCustom($('clientList')); flash('Cliente "'+nome+'" salvo aqui.'); }
  else flash('Não foi possível salvar. O armazenamento do navegador pode estar cheio ou bloqueado.', true);
}

function carregarCliente(nome){
  if(!nome) return;
  var s = lerStore(), c = s.clientes && s.clientes[nome];
  if(!c){ flash('Cliente não encontrado.', true); return; }
  $('clientName').value = nome;
  aplicarFormulario(c.dados);
  $('resultado').className = '';
  if(clienteEmModeloAnterior){
    flash('Cliente "'+nome+'" carregado. Este cliente foi salvo usando o modelo anterior de detalhamento separado. ' +
          'O cálculo continua preservado. Para utilizar a nova tabela unificada, revise e consolide as operações.');
  } else {
    flash('Cliente "'+nome+'" carregado.');
  }
}

function apagarCliente(){
  var nome = $('clientList').value || $('clientName').value.trim();
  if(!nome){ flash('Escolha um cliente salvo para apagar.', true); return; }
  var s = lerStore();
  if(!s.clientes || !s.clientes[nome]){ flash('Cliente não encontrado.', true); return; }
  delete s.clientes[nome];
  gravarStore(s);
  listarClientes();
  flash('Cliente "'+nome+'" apagado.');
}

/* =====================================================================
   VALORES INICIAIS E EVENTOS
   ===================================================================== */
var EXEMPLO = {
  campos: { empresa:'EXEMPLO — Indústria Alfa LTDA', cnpj:'', segmento:'industria',
    faturamento:'500000', compras:'250000', pctCreditavel:'80', pctB2B:'60', pctExportacao:'0',
    /* Valores DEMONSTRATIVOS, carregados só quando o usuário clica em
       "Restaurar exemplo". Já nascem separados porque o modelo combinado deixou
       de ser forma válida de entrada: um exemplo não pode ensinar o formato que
       a ferramenta pede para migrar. */
    atualPis:'4000', atualCofins:'18000', atualPisCofins:'',
    atualIcms:'45000', atualIss:'0', atualIpi:'8000',
    irpj:'12000', csll:'6000', irpjCsll:'', encargosPatronais:'25000', encargosProLabore:'3000',
    isBase:'0', isAliquota:'0', ipiResidualValor:'0', reducaoGeral:'0', ano:'2027', irpjPeriodicidade:'MENSAL' },
  checks: { forcarTodos:0, isSujeita:0, isUsarCustom:0, ipiResidualAtivo:0 },
  receitas: [], premissas: [], isCategoria:'veiculos',
  modos: { pisCofins:'VALUE', icms:'VALUE', iss:'VALUE', ipi:'VALUE' },
  purchaseCreditMode: 'SIMPLE', gruposCompras: [],
  currentRevenueMode: 'SIMPLE', receitasAtuaisDetalhadas: [],
  revenueDetailSchemaVersion: 2, receitasDetalhadasUnificadas: [], legadoDetalheBackup: null
};

/* Sprint 10.2.2 — um cliente novo não nasce com dado econômico nenhum.
   Os campos de valor começam VAZIOS, não em "0,00": um zero preenchido parece
   informação conferida e pode passar despercebido numa revisão. O cálculo
   continua tratando campo vazio como zero; a diferença é só que a tela não
   afirma um valor que ninguém digitou.
   Os controles percentuais permanecem em 0 porque ali o zero é o próprio
   estado neutro do controle, e não um valor histórico da empresa. */
var VAZIO = {
  campos: { empresa:'', cnpj:'', segmento:'comercio',
    faturamento:'', compras:'', pctCreditavel:'0', pctB2B:'0', pctExportacao:'0',
    atualPis:'', atualCofins:'', atualPisCofins:'',
    atualIcms:'', atualIss:'', atualIpi:'',
    irpj:'', csll:'', irpjCsll:'', encargosPatronais:'', encargosProLabore:'',
    isBase:'', isAliquota:'0', ipiResidualValor:'', reducaoGeral:'0', ano:'2027', irpjPeriodicidade:'MENSAL' },
  checks: { forcarTodos:0, isSujeita:0, isUsarCustom:0, ipiResidualAtivo:0 },
  receitas: [], premissas: [], isCategoria:'veiculos',
  modos: { pisCofins:'VALUE', icms:'VALUE', iss:'VALUE', ipi:'VALUE' },
  purchaseCreditMode: 'SIMPLE', gruposCompras: [],
  currentRevenueMode: 'SIMPLE', receitasAtuaisDetalhadas: [],
  revenueDetailSchemaVersion: 2, receitasDetalhadasUnificadas: [], legadoDetalheBackup: null
};

function montarFontes(){
  var f = FISCAL_RULES.fontes;
  $('discFontes').innerHTML =
    '<b>Fontes registradas nesta ferramenta:</b> ' +
    Object.keys(f).map(function(k){ return esc(f[k].rotulo) + ' — ' + esc(f[k].desc); }).join(' · ') +
    '<br><br><b>Data-base do conjunto de premissas:</b> ' + dataBaseBR() + '. ' +
    'A existência de uma fonte não transforma uma estimativa em alíquota definitiva: cada número mantém seu próprio status ' +
    '(definido em norma, estimativa atual, projeção, personalizado ou pendente de lei).';
}

function init(){
  montarCategoriasIS();
  montarFontes();
  $('dataBaseLabel').textContent = dataBaseBR();
  renderPremissas();
  semearAliquotasDaConfig();
  var esc0 = lerEscritorio();
  if(esc0) for(var k in esc0) escritorio[k] = esc0[k];
  renderEscritorio();
  atualizarResumoEscritorio();
  // A aplicação abre limpa. Carregar o exemplo na inicialização fazia números
  // demonstrativos aparecerem como se fossem dados do cliente.
  aplicarFormulario(VAZIO);
  listarClientes();

  $('cnpj').addEventListener('input', function(){
    formatarCampoCNPJ(true);
    agendarConsultaCNPJ();
  });
  $('cnpj').addEventListener('blur', function(){ consultarCNPJReceita(false); });
  $('empresa').addEventListener('input', function(){
    // se o usuário editar o nome, passa a ser manual (não regrava na próxima consulta igual)
    if(this.value.trim() !== cnpjNomeAuto) cnpjNomeAuto = '';
  });
  prepararCamposMoeda();

  // periodicidade do IRPJ + CSLL
  $('irpjPeriodicidade').addEventListener('change', function(){ sincronizarIrpj(); if(ultimoResultado) simular(); });
  $('irpjCsll').addEventListener('input', sincronizarIrpj);

  // dados do escritório
  ['escNome','escCnpj','escRegistro','escContato'].forEach(function(id){
    $(id).addEventListener('input', salvarEscritorioDaTela);
  });
  $('escCnpj').addEventListener('input', function(){
    var pos = this.selectionStart, antes = this.value;
    var novo = mascaraCNPJ(antes);
    if(novo !== antes){
      var uteis = antes.slice(0,pos).replace(/[^0-9A-Za-z]/g,'').length;
      this.value = novo;
      var i=0,c=0; while(i<novo.length && c<uteis){ if(/[0-9A-Za-z]/.test(novo.charAt(i))) c++; i++; }
      try{ this.setSelectionRange(i,i); }catch(e){}
      salvarEscritorioDaTela();
    }
  });
  $('escLogoEscala').addEventListener('input', function(){
    $('escLogoEscalaVal').textContent = this.value + '%';
    document.documentElement.style.setProperty('--logoEscala', this.value/100);
    salvarEscritorioDaTela();
  });
  $('escLogoBtn').addEventListener('click', function(){ $('escLogoFile').click(); });
  $('escLogoDel').addEventListener('click', function(){
    escritorio.logo=''; gravarEscritorio(); atualizarResumoEscritorio(); logoFlash('Logomarca removida.');
  });
  $('escLogoFile').addEventListener('change', function(){
    var f = this.files && this.files[0]; if(!f) return;
    if(f.size > 4*1024*1024){ logoFlash('Imagem muito grande (limite de 4 MB).', true); this.value=''; return; }
    reduzirLogo(f, function(dataUri){
      if(!dataUri){ logoFlash('Não foi possível ler a imagem.', true); return; }
      var anterior = escritorio.logo;
      escritorio.logo = dataUri;
      if(!gravarEscritorio()){
        escritorio.logo = anterior; gravarEscritorio();
        logoFlash('A imagem não coube no armazenamento do navegador. Tente uma menor.', true);
      } else { logoFlash('Logomarca carregada.'); }
      atualizarResumoEscritorio();
    });
    this.value='';
  });
  bloquearRodaEmNumeros();

  ['atualPis','atualCofins'].forEach(function(id){
    $(id).addEventListener('input', sincronizarPisCofins);
  });
  ['irpj','csll'].forEach(function(id){
    $(id).addEventListener('input', sincronizarIrpj);
  });
  $('pcAceite').addEventListener('change', sincronizarPisCofins);
  $('irAceite').addEventListener('change', sincronizarIrpj);

  /* Concluir a migração é ato explícito do usuário. A partir daqui o agregado
     antigo sai do modelo: fica guardado como auditoria e nunca mais volta a ser
     entrada. Nada é dividido automaticamente em momento algum. */
  $('pcConfirmar').addEventListener('click', function(){
    if(!pisCofinsInformados()){ flash('Informe PIS e Cofins antes de confirmar.', true); return; }
    pisCofinsLegadoAuditoria = { valor: pisCofinsLegadoValor, substituidoPor: valoresPisCofinsValue().total };
    pisCofinsPendenteLegado = false;
    pisCofinsLegadoValor = 0;
    $('atualPisCofins').value = '';
    sincronizarPisCofins();
    flash('Separação de PIS e Cofins confirmada. O valor combinado anterior deixa de participar do cálculo.');
    simular();
  });
  $('irConfirmar').addEventListener('click', function(){
    if(!irpjCsllInformados()){ flash('Informe IRPJ e CSLL antes de confirmar.', true); return; }
    var n = normalizarIrpjCsll();
    irpjCsllLegadoAuditoria = { valor: irpjCsllLegadoValor, periodicidade: irpjCsllLegadoPeriodicidade,
                                substituidoPor: n.irpj.informado + n.csll.informado };
    irpjCsllPendenteLegado = false;
    irpjCsllLegadoValor = 0;
    $('irpjCsll').value = '';
    sincronizarIrpj();
    flash('Separação de IRPJ e CSLL confirmada. O valor combinado anterior deixa de participar do cálculo.');
    simular();
  });
  /* Mudar segmento ou marcar "exibir todos" altera QUEM participa do cálculo.
     Deixar o resultado anterior na tela mostraria tributo já suprimido como se
     ainda estivesse sendo cobrado. Nenhum valor é injetado: só a visibilidade
     muda, e o resultado é refeito com os mesmos dados digitados. */
  function aoMudarEscopoDeTributos(){
    sincronizarSegmento();
    atualizarSaidasRate();
    if(ultimoResultado) simular();
  }
  $('segmento').addEventListener('change', aoMudarEscopoDeTributos);
  $('forcarTodos').addEventListener('change', aoMudarEscopoDeTributos);
  montarSeletoresNa(document);
  $('ano').addEventListener('change', function(){
    sincronizarSeletorAno();
    atualizarNotaAno();
    if(purchaseCreditMode === 'DETAILED') totalGruposCompras();   // prévia usa a alíquota do ano
    $('anoResultado').value = this.value;                          // um único estado de ano
    sincronizarSeletorCustom($('anoResultado'));
    if(ultimoResultado) simular();
  });
  // trocar o ano dentro do resultado não pode jogar o usuário para o topo:
  // guardamos a posição do bloco e devolvemos depois de recalcular.
  $('anoResultado').addEventListener('change', function(){
    var ancora = $('resultado');
    var antes = ancora.getBoundingClientRect().top;
    $('ano').value = this.value;
    sincronizarSeletorAno();
    atualizarNotaAno();
    if(purchaseCreditMode === 'DETAILED') totalGruposCompras();
    simular();
    var depois = ancora.getBoundingClientRect().top;
    window.scrollBy(0, depois - antes);
  });

  $('isSujeita').addEventListener('change', sincronizarIS);
  $('isUsarCustom').addEventListener('change', sincronizarIS);
  $('isCategoria').addEventListener('change', atualizarAjudaIS);

  $('ipiResidualAtivo').addEventListener('change', function(){ $('ipiResidualValor').disabled = !this.checked; });

  $('trtAdd').addEventListener('click', function(){
    receitasEspeciais.push({ descricao:'', valor:'', tratamento:'RED_60', pctCustom:'' });
    renderTratamentos();
  });

  // modo avançado de compras
  $('toggleCompras').addEventListener('click', function(){
    purchaseCreditMode = (purchaseCreditMode === 'DETAILED') ? 'SIMPLE' : 'DETAILED';
    sincronizarModoCompras();
    if(ultimoResultado) simular();
  });
  $('toggleAtualDetalhado').addEventListener('click', function(){
    currentRevenueMode = (currentRevenueMode === 'DETAILED') ? 'SIMPLE' : 'DETAILED';
    sincronizarModoAtual();
    if(ultimoResultado) simular();
  });
  $('uniAdd').addEventListener('click', function(){
    receitasDetalhadasUnificadas.push(novaLinhaUnificada());
    renderReceitasUnificadas();
  });
  $('abrirConsolidacao').addEventListener('click', abrirConsolidacao);
  $('consAdd').addEventListener('click', function(){
    if(!consolidacao) return;
    // rascunho novo do próprio usuário: pode nascer sem tratamento escolhido
    var l = novaLinhaUnificada(); l.tratamentoReforma = '';
    consolidacao.linhas.push(l);
    renderConsolidacao();
  });
  $('consConfirmar').addEventListener('click', confirmarConsolidacao);
  $('consCancelar').addEventListener('click', cancelarConsolidacao);

  $('ratAdd').addEventListener('click', function(){
    receitasAtuaisDetalhadas.push({ descricao:'', natureza:'comercio', faturamento:'', pisCofins:'', icms:'', iss:'', ipi:'' });
    renderReceitasAtuais();
  });

  $('cmpAdd').addEventListener('click', function(){
    gruposCompras.push({ descricao:'', valor:'', tipo:'REGULAR_FULL', reducao:'', fatorIbs:'', fatorCbs:'',
                         aliquotaCreditoIbs:'', aliquotaCreditoCbs:'' });
    renderGruposCompras();
  });
  $('compras').addEventListener('input', function(){
    if(purchaseCreditMode === 'DETAILED') totalGruposCompras();
  });
  $('faturamento').addEventListener('input', function(){
    totalTratamentos();
    if(consolidacao) totalConsolidacao();
    else if(modeloUnificadoAtivo()) totalReceitasUnificadas();
    else if(currentRevenueMode === 'DETAILED') totalReceitasAtuais();
  });
  // o campo simplificado de exportações muda a validação e o aviso de duplicidade das linhas
  $('pctExportacao').addEventListener('input', function(){ renderTratamentos(); });

  // alterna VALUE <-> RATE em cada tributo atual, sem perder o que já foi digitado
  TRIBUTOS_MODO.forEach(function(trib){
    $('modo_' + trib).addEventListener('click', function(){
      modosTributo[trib] = (modosTributo[trib] === 'RATE') ? 'VALUE' : 'RATE';
      sincronizarModoTributo(trib);
      if(ultimoResultado) simular();
    });
  });
  CAMPOS_RATE.forEach(function(id){
    $(id).addEventListener('input', function(){
      sincronizarAliquotasAtuais();
      atualizarSaidasRate();
    });
  });

  $('restaurarPremissas').addEventListener('click', function(){
    semearAliquotasDaConfig();
    aplicarCustomizacoes([]);
    sincronizarTodosOsModos();
    flash('Premissas Contabiliza restauradas (data-base ' + dataBaseBR() + ').');
    if(ultimoResultado) simular();
  });

  $('simular').addEventListener('click', function(){
    simular();
    $('resultado').scrollIntoView({ behavior:'smooth', block:'start' });
  });
  $('limpar').addEventListener('click', function(){
    aplicarFormulario(VAZIO);
    $('clientName').value = '';
    $('clientList').value = '';
    sincronizarSeletorCustom($('clientList'));
    $('resultado').className = '';
    ultimoResultado = null;
    flash('Formulário limpo para um novo cliente.');
  });
  $('exemplo').addEventListener('click', function(){
    aplicarFormulario(EXEMPLO);
    $('resultado').className = '';
    ultimoResultado = null;
    // o usuário precisa saber que o que está vendo é demonstração, não cliente
    flash('Exemplo restaurado. Os valores em tela são DEMONSTRATIVOS, não são dados de um cliente real.');
  });

  $('saveClient').addEventListener('click', salvarCliente);
  $('delClient').addEventListener('click', apagarCliente);
  $('clientList').addEventListener('change', function(){ carregarCliente(this.value); });

  function abrirRelatorio(modo){
    // usa sempre o ano selecionado no momento do clique: simular() já foi
    // disparado pelo seletor de ano e ultimoResultado está sincronizado
    if(montarRelatorio(modo) !== true){
      window.scrollTo(0,0);
      return;   // cenário inválido ou fail closed: nenhum relatório é exibido
    }
    document.body.classList.add('previewing');
    window.scrollTo(0,0);
  }
  $('gerarRepresentativo').addEventListener('click', function(){ abrirRelatorio('REPRESENTATIVE'); });
  $('gerarCalculos').addEventListener('click', function(){ abrirRelatorio('CALCULATIONS'); });
  $('gerarCompleto').addEventListener('click', function(){ abrirRelatorio('FULL_TRANSITION'); });
  $('rp_print').addEventListener('click', function(){ window.print(); });
  $('rp_back').addEventListener('click', function(){
    document.body.classList.remove('previewing');
    window.scrollTo(0,0);
  });

  sincronizarPisCofins();
  atualizarNotaAno();
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

/* exposto apenas para inspeção/testes manuais no console do navegador */
window.FiscalCodeLucroReal = {
  regras: function(){ return FISCAL_RULES; },
  padrao: FISCAL_RULES_PADRAO,
  resolveCurrentTaxInput: resolveCurrentTaxInput,
  normalizeCurrentTaxes: normalizeCurrentTaxes,
  validateRevenueClassification: validateRevenueClassification,
  calculateCurrentConsumptionTaxes: calculateCurrentConsumptionTaxes,
  calculateRevenueTreatment: calculateRevenueTreatment,
  calculateIbsCbsDebit: calculateIbsCbsDebit,
  calculatePotentialCredits: calculatePotentialCredits,
  calculateOutputCreditAdjustment: calculateOutputCreditAdjustment,
  calculateDetailedPurchaseCredits: calculateDetailedPurchaseCredits,
  validatePurchaseClassification: validatePurchaseClassification,
  // helpers de normalização/apresentação (fora dos cálculos puros do motor)
  normalizeDetailedCurrentRevenue: normalizeDetailedCurrentRevenue,
  normalizeUnifiedRevenue: normalizeUnifiedRevenue,
  unifiedToEngineRevenue: unifiedToEngineRevenue,
  validateUnifiedTreatments: validateUnifiedTreatments,
  // estado do modelo de receitas, para inspeção manual
  estado: function(){ return { currentRevenueMode: currentRevenueMode,
    revenueDetailSchemaVersion: revenueDetailSchemaVersion,
    receitasDetalhadasUnificadas: receitasDetalhadasUnificadas,
    receitasAtuaisDetalhadas: receitasAtuaisDetalhadas,
    receitasEspeciais: receitasEspeciais,
    consolidacao: consolidacao, legadoDetalheBackup: legadoDetalheBackup,
    clienteEmModeloAnterior: clienteEmModeloAnterior }; },
  validateDetailedCurrentRevenue: validateDetailedCurrentRevenue,
  calculateTaxBurdenBreakdown: calculateTaxBurdenBreakdown,
  pctSobreFaturamento: pctSobreFaturamento,
  calculateLegacyTaxes: calculateLegacyTaxes,
  calculateSelectiveTax: calculateSelectiveTax,
  calculateComplementaryHistoricalLoad: calculateComplementaryHistoricalLoad,
  calculateYearScenario: calculateYearScenario,
  calculateTrajectory: calculateTrajectory,
  coletarDados: coletarDados
};

})();
