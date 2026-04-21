{{/*
Shared chart metadata.
*/}}
{{- define "featbit-rda.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "featbit-rda.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Release-scoped prefix used to name every resource, e.g. "my-release-featbit-rda".
*/}}
{{- define "featbit-rda.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Labels common to every resource in the chart.
Each service must additionally set app.kubernetes.io/component in its own template.
*/}}
{{- define "featbit-rda.labels" -}}
helm.sh/chart: {{ include "featbit-rda.chart" . }}
app.kubernetes.io/name: {{ include "featbit-rda.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Per-component selector labels. Usage:
  {{- include "featbit-rda.selectorLabels" (dict "root" . "component" "track-service") | nindent 4 }}
*/}}
{{- define "featbit-rda.selectorLabels" -}}
app.kubernetes.io/name: {{ include "featbit-rda.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Global imagePullSecrets block (rendered inline when non-empty).
*/}}
{{- define "featbit-rda.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/* ─────────────────────────── track-service helpers ─────────────────────────── */}}

{{/*
Component-qualified resource name, e.g. "my-release-featbit-rda-track-service".
Use this for Deployment / Service / Ingress / HPA / PDB names.
*/}}
{{- define "trackService.fullname" -}}
{{- printf "%s-%s" (include "featbit-rda.fullname" .) "track-service" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "trackService.serviceAccountName" -}}
{{- if .Values.trackService.serviceAccount.create -}}
{{- default (include "trackService.fullname" .) .Values.trackService.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.trackService.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Full image reference: <registry>/<repository>:<tag>.
Falls back to global.imageRegistry when the per-service registry is empty.
*/}}
{{- define "trackService.image" -}}
{{- $reg := .Values.trackService.image.registry | default .Values.global.imageRegistry -}}
{{- $repo := .Values.trackService.image.repository -}}
{{- $tag := .Values.trackService.image.tag | default .Chart.AppVersion -}}
{{- if $reg -}}
{{- printf "%s/%s:%s" $reg $repo $tag -}}
{{- else -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end -}}

{{/*
Secret name holding the ClickHouse connection string. Either the user-provided
existingSecret, or a Secret this chart generates.
*/}}
{{- define "trackService.clickhouseSecretName" -}}
{{- if .Values.trackService.clickHouse.existingSecret -}}
{{- .Values.trackService.clickHouse.existingSecret -}}
{{- else -}}
{{- printf "%s-clickhouse" (include "trackService.fullname" .) -}}
{{- end -}}
{{- end -}}
