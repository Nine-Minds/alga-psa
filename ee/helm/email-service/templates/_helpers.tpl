{{/*
Expand the name of the chart.
*/}}
{{- define "email-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "email-service.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "email-service.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "email-service.labels" -}}
helm.sh/chart: {{ include "email-service.chart" . }}
{{ include "email-service.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "email-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "email-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "email-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "email-service.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return the namespace
*/}}
{{- define "email-service.namespace" -}}
{{- default .Release.Namespace .Values.namespace -}}
{{- end -}}

{{/*
Render an image reference as name[:tag][@digest] from a dict with name, tag and
digest keys. Fails when name is empty or when digest is set but is not
sha256:<64 lowercase hex>.
*/}}
{{- define "email-service.imageRef" -}}
{{- $name := required "image name is required" .name -}}
{{- if and .digest (not (regexMatch "^sha256:[0-9a-f]{64}$" .digest)) -}}
{{- fail (printf "image digest %q must match sha256:<64 lowercase hex characters>" .digest) -}}
{{- end -}}
{{- $ref := $name -}}
{{- if .tag -}}{{- $ref = printf "%s:%s" $ref .tag -}}{{- end -}}
{{- if .digest -}}{{- $ref = printf "%s@%s" $ref .digest -}}{{- end -}}
{{- $ref -}}
{{- end }}
