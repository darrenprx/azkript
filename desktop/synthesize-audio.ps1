param([Parameter(Mandatory=$true)][string]$InputPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$speechItems=ConvertFrom-Json ([System.IO.File]::ReadAllText($InputPath,[System.Text.Encoding]::UTF8))
$synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $defaultVoice=$synth.Voice.Name
  $synth.SetOutputToWaveFile($OutputPath)
  foreach($speechItem in $speechItems){
    if($speechItem.voice){$synth.SelectVoice([string]$speechItem.voice)}else{$synth.SelectVoice($defaultVoice)}
    $spokenText=[System.Security.SecurityElement]::Escape([string]$speechItem.text)
    $voiceLanguage=$synth.Voice.Culture.Name
    $ratePercent=[int]([double]$speechItem.rate*100)
    $pitchPercent=[int](([double]$speechItem.pitch-1)*50)
    $pitchValue=if($pitchPercent -ge 0){"+$pitchPercent%"}else{"$pitchPercent%"}
    $ssml="<speak version='1.0' xml:lang='$voiceLanguage' xmlns='http://www.w3.org/2001/10/synthesis'><prosody rate='$ratePercent%' pitch='$pitchValue'>$spokenText</prosody><break time='500ms'/></speak>"
    $synth.SpeakSsml($ssml)
  }
  $synth.SetOutputToNull()
}finally{$synth.Dispose()}
