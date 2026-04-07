/* Includes ------------------------------------------------------------------*/
#include "DEV_Config.h"
#include "EPD_2in9_V2.h"
#include "GUI_Paint.h"
#include "ImageData.h"
#include <stdlib.h>
#include "max6675.h"

//Create a new image cache
UBYTE *BlackImage;

// pin definitions
#define PRES_SENSOR 34
#define STOP_BUTTON 35

int thermoDO = 25;
int thermoCS = 33;
int thermoCLK = 32;

MAX6675 thermocouple(thermoCLK, thermoCS, thermoDO);

// define constants
static float voltage_divider = 3.3 / (1.68 + 3.3);

/* Entry point ----------------------------------------------------------------*/
void setup()
{
	printf("EPD_2IN9_V2_test Demo\r\n");
	DEV_Module_Init();

    printf("e-Paper Init and Clear...\r\n");
    EPD_2IN9_V2_Init();
    EPD_2IN9_V2_Clear();
    DEV_Delay_ms(500);

    /* you have to edit the startup_stm32fxxx.s file and set a big enough heap size */
    UWORD Imagesize = ((EPD_2IN9_V2_WIDTH % 8 == 0)? (EPD_2IN9_V2_WIDTH / 8 ): (EPD_2IN9_V2_WIDTH / 8 + 1)) * EPD_2IN9_V2_HEIGHT;
    if((BlackImage = (UBYTE *)malloc(Imagesize)) == NULL) {
        printf("Failed to apply for black memory...\r\n");
        while(1);
    }

///////////////////////////////////////////////////////////////////////////////////////////////////////////// begin drawing

#if 1 // draw text to screen

    free(BlackImage);
    printf("show Gray------------------------\r\n");
    Imagesize = ((EPD_2IN9_V2_WIDTH % 4 == 0)? (EPD_2IN9_V2_WIDTH / 4 ): (EPD_2IN9_V2_WIDTH / 4 + 1)) * EPD_2IN9_V2_HEIGHT;
    if((BlackImage = (UBYTE *)malloc(Imagesize)) == NULL) {
        printf("Failed to apply for black memory...\r\n");
        while(1);
    }
    EPD_2IN9_V2_Gray4_Init();
    printf("4 grayscale display\r\n");
    Paint_NewImage(BlackImage, EPD_2IN9_V2_WIDTH, EPD_2IN9_V2_HEIGHT, 270, WHITE);
    Paint_SetScale(4);
    Paint_Clear(0xff);


    for (;;) {
        if(analogRead(STOP_BUTTON) * (3.3/4095) > 1){ // if the button is pressed, puts the screen to sleep
            break;
        }
        // analog value from the pin
        int adc_val = analogRead(PRES_SENSOR);
        // the measured voltage
        float mes_voltage = adc_val * (3.3/4095);
        // undo the voltage divider
        float sensor_voltage = mes_voltage / voltage_divider;
        // voltage -> pressure
        float pressure = (800 + (sensor_voltage * (1060-800)/(5))) * 100 * 760 / 101325;

        float temperature = thermocouple.readCelsius();

        // given a float, turn it into a string
        String pres = String(pressure);
        String temp = String(temperature);

        // clear the screen?
        Paint_Clear(WHITE);

        // draw everything on the screen
        Paint_DrawString_EN(148, 10, "UO Lab Status", &Font16, WHITE, BLACK);
        Paint_DrawString_EN(148, 30, "Pressure(mmHg):", &Font12, WHITE, BLACK);
        Paint_DrawString_EN(148, 50, "Temperature(C):", &Font12, WHITE, BLACK);
        Paint_DrawString_EN(253, 30, pres.c_str(), &Font12, WHITE, BLACK);
        Paint_DrawString_EN(253, 50, temp.c_str(), &Font12, WHITE, BLACK);
        
        // partial refresh
        EPD_2IN9_V2_Display_Partial(BlackImage);
        
        DEV_Delay_ms(500); // 1 second delay = 500

    }

#endif

///////////////////////////////////////////////////////////////////////////////////////////////////////////// end drawing

    // clear the screen
    printf("Clear...\r\n");
    EPD_2IN9_V2_Init();
    EPD_2IN9_V2_Clear();

    // put device to sleep
    printf("Goto Sleep...\r\n");
    EPD_2IN9_V2_Sleep();
    free(BlackImage);
    BlackImage = NULL;
}

/* The main loop -------------------------------------------------------------*/
void loop()
{
  //
}
