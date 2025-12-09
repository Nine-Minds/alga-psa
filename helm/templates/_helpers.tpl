{{/*
Expand the name of the chart.
*/}}
{{- define "sebastian.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "sebastian.fullname" -}}
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
{{- define "sebastian.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "sebastian.labels" -}}
helm.sh/chart: {{ include "sebastian.chart" . }}
{{ include "sebastian.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "sebastian.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sebastian.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Safely check if hostedEnv is enabled.
     Returns "true" if hostedEnv exists and is enabled, empty string otherwise. */}}
{{- define "sebastian.hostedEnvEnabled" -}}
{{- if and .Values.hostedEnv .Values.hostedEnv.enabled -}}true{{- end -}}
{{- end }}

{{/* Resolve the correct namespace for the resource.
     Returns a trimmed single-line string to avoid newline emission in include sites. */}}
{{- define "sebastian.namespace" -}}{{- if .Values.devEnv.enabled -}}{{- .Values.devEnv.namespace -}}{{- else if (include "sebastian.hostedEnvEnabled" .) -}}{{- .Values.hostedEnv.namespace -}}{{- else -}}{{- .Values.namespace -}}{{- end -}}{{- end }}

{{/* Derive deployment color from release name */}}
{{- define "sebastian.color" -}}
{{- $rn := .Release.Name -}}
{{- if hasSuffix "-blue" $rn -}}blue{{- else if hasSuffix "-green" $rn -}}green{{- else -}}{{- "" -}}{{- end -}}
{{- end }}

{{/* Resolve host for app:
     - If release is colored (-blue/-green) and .Values.domainSuffix is set -> <color>.<domainSuffix>
     - Else if .Values.host is set -> .Values.host
     - Else fallback to .Values.domainSuffix (may be empty) */}}
{{- define "sebastian.resolveHost" -}}
{{- $host := default "" .Values.host -}}
{{- $suffix := default "" .Values.domainSuffix -}}
{{- $color := include "sebastian.color" . -}}
{{- if and $color (ne $color "") (ne $suffix "") -}}
{{- printf "%s.%s" $color $suffix -}}
{{- else if ne $host "" -}}
{{- $host -}}
{{- else -}}
{{- $suffix -}}
{{- end -}}
{{- end }}

{{/* Render GOOGLE_OAUTH_* env vars from gmail_integration config */}}
{{- define "sebastian.googleOAuthEnv" -}}
{{- if and .Values.gmail_integration.enabled .Values.gmail_integration.client_id .Values.gmail_integration.client_secret }}
- name: GOOGLE_OAUTH_CLIENT_ID
  value: "{{ .Values.gmail_integration.client_id }}"
- name: GOOGLE_OAUTH_CLIENT_SECRET
  value: "{{ .Values.gmail_integration.client_secret }}"
{{- end }}
{{- end }}

{{/*
Render MICROSOFT_OAUTH_* env vars using the microsoft_integration config.
*/}}
{{- define "sebastian.microsoftOAuthEnv" -}}
{{- if and .Values.microsoft_integration.enabled .Values.microsoft_integration.client_id }}
- name: MICROSOFT_OAUTH_CLIENT_ID
  value: "{{ .Values.microsoft_integration.client_id }}"
{{- end }}
{{- if and .Values.microsoft_integration.enabled .Values.microsoft_integration.client_secret }}
- name: MICROSOFT_OAUTH_CLIENT_SECRET
  value: "{{ .Values.microsoft_integration.client_secret }}"
{{- end }}
{{- end }}

{{/* Render NINJAONE_OAUTH_* env vars from ninjaone_integration config */}}
{{- define "sebastian.ninjaonetOAuthEnv" -}}
{{- if and .Values.ninjaone_integration.enabled .Values.ninjaone_integration.client_id }}
- name: NINJAONE_OAUTH_CLIENT_ID
  value: "{{ .Values.ninjaone_integration.client_id }}"
{{- end }}
{{- if and .Values.ninjaone_integration.enabled .Values.ninjaone_integration.client_secret }}
- name: NINJAONE_OAUTH_CLIENT_SECRET
  value: "{{ .Values.ninjaone_integration.client_secret }}"
{{- end }}
{{- end }}
