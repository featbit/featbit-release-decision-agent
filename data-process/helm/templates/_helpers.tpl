{{- define "data-process.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{ .Values.secrets.existingSecret }}
{{- else -}}
{{ include "data-process.fullname" . }}-secrets
{{- end -}}
{{- end -}}

{{- define "data-process.fullname" -}}
{{ .Release.Name }}-data-process
{{- end -}}
