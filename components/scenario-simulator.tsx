'use client'

import { useMemo, useState } from 'react'
import { simulate, monthsToGoal, type ScenarioInput } from '@/lib/simulator'
import { formatBRL, formatPercent } from '@/lib/money'
import { Card, Badge, ProgressBar } from '@/components/ui/primitives'

/**
 * Simulador interativo.
 *
 * Recalcula no navegador a cada movimento — o objetivo é o usuário conseguir
 * "sentir" a alavanca (ticket, volume, custo, split) em vez de pedir um
 * relatório e esperar.
 */

interface Props {
  initial: ScenarioInput
  goalCents: number
  currentRevenueCents: number
}

export function ScenarioSimulator({ initial, goalCents, currentRevenueCents }: Props) {
  const [input, setInput] = useState<ScenarioInput>(initial)
  const result = useMemo(() => simulate(input), [input])
  const baseline = useMemo(() => simulate(initial), [initial])

  const growth = 0.05
  const months = monthsToGoal(result.grossRevenueCents, goalCents, growth)

  const set = <K extends keyof ScenarioInput>(key: K, value: ScenarioInput[K]) =>
    setInput((prev) => ({ ...prev, [key]: value }))

  const delta = result.grossRevenueCents - baseline.grossRevenueCents

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Card className="lg:col-span-2" title="Alavancas" subtitle="Mexa e veja o resultado ao lado">
        <div className="space-y-5 px-5 py-4">
          <Slider
            label="Consultas por mês"
            value={input.sessionsPerMonth}
            min={0}
            max={120}
            step={1}
            display={`${input.sessionsPerMonth}`}
            onChange={(v) => set('sessionsPerMonth', v)}
            hint={
              result.overCapacity
                ? `Acima do teto da agenda (${result.capacitySessions} cabem)`
                : `${result.capacitySessions} cabem na agenda`
            }
            danger={result.overCapacity}
          />
          <Slider
            label="Ticket da consulta"
            value={input.sessionTicketCents / 100}
            min={50}
            max={1500}
            step={10}
            display={formatBRL(input.sessionTicketCents)}
            onChange={(v) => set('sessionTicketCents', Math.round(v * 100))}
          />
          <Slider
            label="Receita de infoprodutos"
            value={input.infoproductRevenueCents / 100}
            min={0}
            max={30000}
            step={100}
            display={formatBRL(input.infoproductRevenueCents)}
            onChange={(v) => set('infoproductRevenueCents', Math.round(v * 100))}
            hint="Não consome hora do Yuri"
          />
          <Slider
            label="Custo fixo mensal"
            value={input.fixedCostsCents / 100}
            min={0}
            max={20000}
            step={50}
            display={formatBRL(input.fixedCostsCents)}
            onChange={(v) => set('fixedCostsCents', Math.round(v * 100))}
          />
          <Slider
            label="Investimento em tráfego"
            value={input.marketingCents / 100}
            min={0}
            max={20000}
            step={50}
            display={formatBRL(input.marketingCents)}
            onChange={(v) => set('marketingCents', Math.round(v * 100))}
          />
          <Slider
            label="Alíquota de imposto"
            value={input.taxRate * 100}
            min={0}
            max={20}
            step={0.5}
            display={formatPercent(input.taxRate)}
            onChange={(v) => set('taxRate', v / 100)}
          />

          <div className="border-t border-hairline pt-4">
            <p className="mb-3 text-[12px] font-medium uppercase tracking-wide text-ink-muted">
              Regra de divisão
            </p>
            <Slider
              label="Caixa da empresa"
              value={input.companyPct}
              min={0}
              max={60}
              step={1}
              display={`${input.companyPct}%`}
              onChange={(v) => set('companyPct', v)}
            />
            <div className="mt-4">
              <Slider
                label="Gustavo (do que sobra)"
                value={input.gustavoPct}
                min={0}
                max={60}
                step={1}
                display={`${input.gustavoPct}% · Yuri ${100 - input.gustavoPct}%`}
                onChange={(v) => setInput((prev) => ({ ...prev, gustavoPct: v, yuriPct: 100 - v }))}
              />
            </div>
          </div>

          <div className="border-t border-hairline pt-4">
            <Slider
              label="Horas de agenda por semana"
              value={input.weeklyHours}
              min={5}
              max={50}
              step={1}
              display={`${input.weeklyHours} h`}
              onChange={(v) => set('weeklyHours', v)}
            />
          </div>

          <button
            type="button"
            onClick={() => setInput(initial)}
            className="w-full rounded-lg border border-hairline px-3 py-2 text-[13px] text-ink-2 hover:bg-surface-2"
          >
            Voltar ao cenário atual
          </button>
        </div>
      </Card>

      <div className="space-y-3 lg:col-span-3">
        <Card title="Resultado do cenário" subtitle="Por mês, com as alavancas acima">
          <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
            <Metric label="Faturamento bruto" value={formatBRL(result.grossRevenueCents)} delta={delta} />
            <Metric label="Resultado operacional" value={formatBRL(result.operatingResultCents)} tone={result.operatingResultCents < 0 ? 'critical' : 'good'} />
            <Metric label="Yuri recebe" value={formatBRL(result.yuriCents)} tone={result.yuriFloorMet ? 'good' : 'critical'} hint={result.yuriFloorMet ? 'piso atingido' : `piso de ${formatBRL(input.yuriFloorCents)} não atingido`} />
            <Metric label="Gustavo recebe" value={formatBRL(result.gustavoCents)} />
            <Metric label="Caixa da empresa" value={formatBRL(result.companyCents)} hint={`${formatPercent(result.grossRevenueCents ? result.companyCents / result.grossRevenueCents : 0)} do faturamento`} />
            <Metric label="Margem líquida" value={formatPercent(result.netMargin)} />
          </div>
        </Card>

        <Card title="Leitura do cenário" subtitle="O que esses números significam">
          <div className="space-y-3 px-5 py-4 text-[13.5px] text-ink-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={result.grossRevenueCents >= goalCents ? 'good' : 'serious'}>
                {result.grossRevenueCents >= goalCents ? 'Meta batida neste cenário' : 'Abaixo da meta'}
              </Badge>
              {result.overCapacity && <Badge tone="critical">Agenda estourada</Badge>}
              {!result.yuriFloorMet && <Badge tone="warning">Piso do Yuri não coberto</Badge>}
            </div>

            <ProgressBar
              ratio={result.grossRevenueCents / goalCents}
              tone={result.grossRevenueCents >= goalCents ? 'good' : 'info'}
            />

            <p>
              Neste cenário o faturamento é <strong>{formatBRL(result.grossRevenueCents)}</strong> contra a
              meta de {formatBRL(goalCents)}
              {result.grossRevenueCents < goalCents && (
                <> — faltam <strong>{formatBRL(goalCents - result.grossRevenueCents)}</strong></>
              )}
              .
            </p>

            <p>
              A agenda comporta <strong>{result.capacitySessions} atendimentos</strong> por mês
              ({formatPercent(result.occupancyRatio)} de ocupação neste cenário).
              {result.overCapacity && (
                <>
                  {' '}
                  Como está, o Yuri precisaria atender mais do que cabe — o caminho é ticket maior ou
                  infoproduto.
                </>
              )}
            </p>

            <p>
              Para o Yuri retirar {formatBRL(input.yuriFloorCents)}, o faturamento bruto precisa chegar a{' '}
              <strong>{formatBRL(result.grossNeededForFloorCents)}</strong> com esta estrutura de custo e
              esta regra de divisão.
            </p>

            <p>
              O ponto de equilíbrio é <strong>{formatBRL(result.breakEvenRevenueCents)}</strong>: abaixo
              disso, o mês fecha no vermelho antes de qualquer retirada.
            </p>

            <p>
              Partindo de {formatBRL(currentRevenueCents)} e crescendo 5% ao mês, a meta chega em{' '}
              <strong>{months !== null ? `${months} meses` : 'mais de 3 anos'}</strong>.
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  hint,
  danger,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  hint?: string
  danger?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-[13px] text-ink-2">{label}</label>
        <span className="tabular text-[13px] font-medium text-ink">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[var(--series-1)]"
      />
      {hint && (
        <p className={`mt-1 text-[12px] ${danger ? 'text-[var(--critical)]' : 'text-ink-muted'}`}>{hint}</p>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  delta,
  tone,
}: {
  label: string
  value: string
  hint?: string
  delta?: number
  tone?: 'good' | 'critical'
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={`mt-1 text-[20px] font-semibold ${
          tone === 'critical' ? 'text-[var(--critical)]' : tone === 'good' ? 'text-[var(--good-text)]' : 'text-ink'
        }`}
      >
        {value}
      </p>
      {delta !== undefined && delta !== 0 && (
        <p className="mt-0.5 text-[12px] text-ink-muted">
          {delta > 0 ? '+' : ''}
          {formatBRL(delta)} vs. cenário atual
        </p>
      )}
      {hint && <p className="mt-0.5 text-[12px] text-ink-muted">{hint}</p>}
    </div>
  )
}
