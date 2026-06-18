import os
from openai import OpenAI
from dotenv import load_dotenv
# Importa a biblioteca gratuita que controla o WhatsApp
from wppconnect import WppconnectInstance

# 1. Carrega a sua API Key secreta da NVIDIA (.env)
load_dotenv()
chave_nvidia = os.getenv("NVIDIA_API_KEY")

# 2. Inicializa o cérebro da Inteligência Artificial (DeepSeek)
client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=chave_nvidia
)

# 3. Lê o seu manual de regras do consultório (PROMPT_MARIA.md)
with open("PROMPT_MARIA.md", "r", encoding="utf-8") as arquivo_prompt:
    instrucoes_da_maria = arquivo_prompt.read()

# 4. Esta função será executada TODA VEZ que alguém mandar mensagem no WhatsApp
def processar_nova_mensagem(whatsapp_client, message):
    # Ignora mensagens enviadas por você mesmo ou de grupos para não dar loop
    if message.get('fromMe') or message.get('isGroup'):
        return

    # Captura o texto que o paciente digitou e o número dele
    texto_do_paciente = message.get('body')
    numero_do_paciente = message.get('from')

    print(f"Paciente ({numero_do_paciente}) enviou: {texto_do_paciente}")

    try:
        # 5. Envia o histórico/regras e a mensagem do paciente para o DeepSeek
        completion = client.chat.completions.create(
            model="deepseek-ai/deepseek-v4-pro",
            messages=[
                {"role": "system", "content": instrucoes_da_maria},
                {"role": "user", "content": texto_do_paciente}
            ],
            temperature=0.7,
            top_p=0.95,
            max_tokens=2000, # Diminuímos o limite de resposta para o WhatsApp não ficar gigante
            extra_body={"chat_template_kwargs": {"thinking": False}},
            stream=False
        )

        # Captura a resposta inteligente gerada pela Maria
        resposta_da_maria = completion.choices[0].message.content

        # 6. Manda a resposta de volta para o WhatsApp do paciente
        whatsapp_client.send_text(numero_do_paciente, resposta_da_maria)
        print(f"Maria respondeu: {resposta_da_maria}")

    except Exception as e:
        print(f"Ocorreu um erro ao processar com a IA: {e}")

# 7. Inicializa o robô do WhatsApp
# Quando você rodar isso, um QR Code vai aparecer na tela do seu terminal!
print("Iniciando a Maria... Por favor, aguarde o QR Code para escanear com o celular.")
wpp = WppconnectInstance(session_name="MariaSecretaria")

# Diz para o robô: "Fique de olho e execute a função acima sempre que chegar mensagem"
wpp.on_message(processar_nova_mensagem)

# Mantém o programa rodando no computador
wpp.start()
