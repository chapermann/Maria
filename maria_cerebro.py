import os
from openai import OpenAI
from dotenv import load_dotenv

# 1. Carrega as chaves secretas do ambiente (arquivo oculto .env)
load_dotenv()
chave_nvidia = os.getenv("NVIDIA_API_KEY")

# 2. Inicializa o cliente da NVIDIA usando o código padrão que você recebeu
client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=chave_nvidia
)

# 3. Faz o Python ler o manual da Maria para saber como agir no consultório
with open("PROMPT_MARIA.md", "r", encoding="utf-8") as arquivo_prompt:
    instrucoes_da_maria = arquivo_prompt.read()

# --- SIMULAÇÃO DE MENSAGEM DO WHATSAPP ---
# Quando integrarmos com o WhatsApp, esta variável receberá a mensagem real do paciente
mensagem_do_paciente = "Olá! Quero agendar uma consulta com a Dra Rebeca pelo convênio da GEAP."
# -----------------------------------------

# 4. Envia o texto para o DeepSeek processar seguindo as diretrizes da Maria
completion = client.chat.completions.create(
    model="deepseek-ai/deepseek-v4-pro",
    messages=[
        {"role": "system", "content": instrucoes_da_maria},
        {"role": "user", "content": mensagem_do_paciente}
    ],
    temperature=0.7,  # Ajustado para respostas mais precisas e profissionais
    top_p=0.95,
    max_tokens=16384,
    extra_body={"chat_template_kwargs": {"thinking": False}},
    stream=False
)

# 5. Entrega o resultado final estruturado
print(completion.choices[0].message.content)